/**
 * Atomic indexer persist: every log-derived write in a tick shares one
 * transaction with cursor advancement (`indexer_state.block` + `block_hash`).
 *
 * RPC (getLogs, timestamps, head hash) stays outside. SSE publishes after commit.
 * Full-market roll + external marks run after commit; incremental 24h rolls stay inside.
 */
import type { Store } from "./db.ts";
import {
  curvePriceX18,
  recordTrade,
  setState,
  upsertMarket,
  upsertOfficialPool,
  upsertToken,
  type SsePublisher,
} from "./ingest.ts";
import { persistVenue, poolKeyBytes, updateVenueMarksFromSqrt } from "./route-graph.ts";
import { EVENT_IDENTITY_CONFLICT, insertLogOnce, journalEvent, normalizeEventAddress } from "./event-identity.ts";
import { priceQuoteX18FromSqrt } from "../../../packages/reactor/src/prices.ts";

export type TickLog = {
  eventName?: string;
  args?: Record<string, unknown>;
  address?: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex?: number | bigint | null;
};

export type TickPersistCtx = {
  chainId: number;
  factory: string;
  hook: string;
  protocolAdapter?: string;
  userAdapter?: string;
  tokenByPool: Map<string, { token: string; quote: string }>;
  quoteDec: Map<string, number>;
};

export type TickSseEvent = { type: string; data: unknown };

export type TickPersistInput = {
  logs: TickLog[];
  timestamps: Map<number, number>;
  cursorBlock: string;
  cursorHash: string;
  ctx: TickPersistCtx;
};

class CollectingSse implements SsePublisher {
  readonly events: TickSseEvent[] = [];
  publish(ev: TickSseEvent) {
    this.events.push(ev);
  }
}

export async function rewindIndexerCursor(store: Store, block: string): Promise<void> {
  await store.transaction(async (tx) => {
    await setState(tx, "block", block);
    await setState(tx, "block_hash", "");
  });
}

export async function persistTickBatch(store: Store, input: TickPersistInput): Promise<TickSseEvent[]> {
  const tokenByPool = new Map(input.ctx.tokenByPool);
  const sse = new CollectingSse();
  await store.transaction(async (tx) => {
    const lastSqrt = new Map<string, string>();
    for (const log of input.logs) {
      await persistOneLog(tx, log, input.timestamps, { ...input.ctx, tokenByPool }, lastSqrt, sse);
    }
    await setState(tx, "block", input.cursorBlock);
    await setState(tx, "block_hash", input.cursorHash);
  });
  for (const [k, v] of tokenByPool) input.ctx.tokenByPool.set(k, v);
  return sse.events;
}

async function persistOneLog(
  store: Store,
  log: TickLog,
  timestamps: Map<number, number>,
  ctx: TickPersistCtx,
  lastSqrt: Map<string, string>,
  sse: SsePublisher,
) {
  const name = log.eventName ?? "unknown";
  const args = (log.args ?? {}) as Record<string, unknown>;
  const token = String(args.token ?? "");
  const block = Number(log.blockNumber);
  const ts = timestamps.get(block) ?? 0;
  const tx = log.transactionHash;
  const logIndex = Number(log.logIndex ?? 0);
  const chainId = ctx.chainId;
  const emitting = normalizeEventAddress(log.address ?? token);
  const factory = ctx.factory;
  const hook = ctx.hook;
  const tokenByPool = ctx.tokenByPool;
  const quoteDec = ctx.quoteDec;

  if (name === "TokenCreated") {
    await upsertToken(store, {
      address: token,
      name: String(args.name ?? ""),
      symbol: String(args.symbol ?? ""),
      ticker: String(args.symbol ?? ""),
      supply: String(args.supply ?? ""),
      creator: String(args.creator ?? ""),
      block,
      tx,
      ts,
    });
    sse.publish({ type: "launch", data: { token, name: args.name, symbol: args.symbol, tx } });
  }
  if (name === "LaunchCreated" || name === "InstantLaunchCreated") {
    await upsertToken(store, {
      address: token,
      quote: String(args.quote ?? ""),
      creator: String(args.creator ?? ""),
      rewardsMode: Boolean(args.rewardsMode ?? true),
      block,
      tx,
      ts,
    });
    await upsertMarket(store, { token, quote: String(args.quote ?? ""), stage: "bonding", gradTarget: String(args.gradTarget ?? ""), ts });
  }
  if (name === "LaunchAuthorized") {
    await upsertToken(store, {
      address: token,
      ticker: String(args.ticker ?? ""),
      factoryVersion: Number(args.factoryVersion ?? 1),
      block,
      tx,
      ts,
    });
  }
  if (name === "TickerClaimed" || name === "TickerPermanentlyLocked") {
    const ticker = String(args.ticker ?? "").toUpperCase();
    await store.run(
      `INSERT INTO tickers(ticker,token,factory,factory_version,locked_until,permanent,reserved)
       VALUES(?,?,?,?,?,?,?) ON CONFLICT(ticker) DO UPDATE SET token=excluded.token, locked_until=excluded.locked_until, permanent=excluded.permanent`,
      ticker,
      String(args.token ?? args.canonicalToken ?? "").toLowerCase(),
      String(args.factory ?? ""),
      Number(args.version ?? 0),
      Number(args.lockedUntil ?? 0),
      name === "TickerPermanentlyLocked" ? 1 : 0,
      name === "TickerPermanentlyLocked" && !args.canonicalToken ? 1 : 0,
    );
  }
  if (name === "OfficialPoolCreated" || name === "GraduationCompleted") {
    const poolId = String(args.poolId ?? "");
    const quoteFromHook = String(args.quote ?? "");
    tokenByPool.set(poolId, { token: token.toLowerCase(), quote: quoteFromHook });
    await upsertOfficialPool(store, {
      poolId,
      token,
      quote: String(args.quote ?? ""),
      factory,
      mode: Number(args.mode ?? 0),
      hook: hook ?? "",
      block,
      tx,
      ts,
    });
    await store.run(
      `INSERT INTO pool_relationships(pool_id,token,quote,venue,fee,hooks,exists_onchain,approved,created_block)
       VALUES(?,?,?,?,?,?,1,1,?) ON CONFLICT(pool_id) DO UPDATE SET exists_onchain=1, approved=1, token=excluded.token, quote=COALESCE(NULLIF(excluded.quote,''),pool_relationships.quote)`,
      poolId,
      token.toLowerCase(),
      String(args.quote ?? "").toLowerCase(),
      "OFFICIAL_REACTOR_V4",
      0,
      hook ?? "",
      block,
    );
    await upsertMarket(store, { token, poolId, stage: "v4", marketLive: true, ts });
    const protocol = ctx.protocolAdapter;
    const user = ctx.userAdapter;
    const quote = String(args.quote ?? "");
    if (protocol && quote && hook) {
      const data = poolKeyBytes(token as `0x${string}`, quote as `0x${string}`, 0, hook as `0x${string}`);
      await persistVenue(store, { tokenIn: quote, tokenOut: token, adapter: protocol, kind: "protocol", data, poolId, exists: true, approved: true });
      await persistVenue(store, { tokenIn: token, tokenOut: quote, adapter: protocol, kind: "protocol", data, poolId, exists: true, approved: true });
      if (user) {
        await persistVenue(store, { tokenIn: quote, tokenOut: token, adapter: user, kind: "user", data, poolId, exists: true, approved: true });
        await persistVenue(store, { tokenIn: token, tokenOut: quote, adapter: user, kind: "user", data, poolId, exists: true, approved: true });
      }
    }
    if (name === "GraduationCompleted") {
      await store.run(
        `INSERT INTO graduations(token,pool_id,quote_lp,token_lp,block,tx,ts) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(token) DO UPDATE SET pool_id=excluded.pool_id`,
        token.toLowerCase(),
        poolId,
        String(args.quoteLp ?? "0"),
        String(args.tokenLp ?? "0"),
        block,
        tx,
        ts,
      );
      sse.publish({ type: "graduation", data: { token, poolId, tx } });
    }
  }
  if (name === "Swap" && args.id && args.sqrtPriceX96) {
    lastSqrt.set(String(args.id), String(args.sqrtPriceX96));
    await updateVenueMarksFromSqrt(store, String(args.id), String(args.sqrtPriceX96), quoteDec);
  }
  if (name === "BondingProgress") {
    await store.run(
      `INSERT INTO bonding_states(token,real_quote,grad_target,inventory,ready,graduated,bonding_bps,updated_ts)
       VALUES(?,?,?,?,0,0,0,?) ON CONFLICT(token) DO UPDATE SET real_quote=excluded.real_quote, grad_target=excluded.grad_target, inventory=excluded.inventory, updated_ts=excluded.updated_ts`,
      token.toLowerCase(),
      String(args.realQuote ?? "0"),
      String(args.gradTarget ?? "0"),
      String(args.inventory ?? "0"),
      ts,
    );
    await upsertMarket(store, { token, realQuote: String(args.realQuote ?? "0"), gradTarget: String(args.gradTarget ?? "0"), stage: "bonding", ts });
    sse.publish({ type: "bonding", data: { token, realQuote: args.realQuote, gradTarget: args.gradTarget } });
  }
  if (name === "CurveBuy" || name === "CurveSell") {
    const quoteIn = String(args.quoteIn ?? args.quoteOut ?? "0");
    const tokens = String(args.tokensOut ?? args.tokensIn ?? "0");
    const mkt = await store.get<{ quote: string }>("SELECT quote FROM markets WHERE token=?", token.toLowerCase());
    const q = mkt?.quote ?? "";
    const qDec = quoteDec.get(q) ?? 18;
    const px = curvePriceX18(quoteIn, tokens, qDec, 18);
    await recordTrade(store, sse, {
      block,
      tx,
      logIndex,
      chainId,
      eventKind: name,
      address: emitting,
      token,
      quote: q,
      side: name === "CurveBuy" ? "buy" : "sell",
      source: "curve",
      amountIn: name === "CurveBuy" ? quoteIn : tokens,
      amountOut: name === "CurveBuy" ? tokens : quoteIn,
      notionalQuote: quoteIn,
      priceQuoteX18: px,
      ts,
    });
  }
  if (name === "SwapFeeAccrued") {
    const poolId = String(args.poolId ?? "");
    const mapped = tokenByPool.get(poolId);
    const q = String(args.quote ?? mapped?.quote ?? "");
    const tok = mapped?.token ?? "";
    const sqrt = lastSqrt.get(poolId) ?? "";
    let px = "0";
    if (sqrt && tok && q) {
      try {
        const tokenIs0 = tok.toLowerCase() < q.toLowerCase();
        px = priceQuoteX18FromSqrt(BigInt(sqrt), tokenIs0, 18, quoteDec.get(q.toLowerCase()) ?? 18).toString();
      } catch {
        px = "0";
      }
    }
    await recordTrade(store, sse, {
      block,
      tx,
      logIndex,
      chainId,
      eventKind: name,
      address: emitting || tok,
      token: tok,
      quote: q,
      side: "swap",
      source: "v4",
      amountIn: String(args.notional ?? "0"),
      amountOut: "0",
      notionalQuote: String(args.notional ?? "0"),
      priceQuoteX18: px,
      sqrtPrice: sqrt,
      holders: String(args.holders ?? "0"),
      flywheel: String(args.flywheel ?? "0"),
      core: String(args.coreAmt ?? "0"),
      ts,
    });
  }
  if (name === "RewardClaimed") {
    const addr = emitting || token.toLowerCase();
    const claimed = await journalEvent(store, { chainId, tx, logIndex, eventKind: name, address: addr, block, ts });
    const claimRow = await insertLogOnce(
      store,
      `INSERT INTO claims(token,account,amount,block,tx,ts,chain_id,log_index,event_kind) VALUES(?,?,?,?,?,?,?,?,?)
       ${EVENT_IDENTITY_CONFLICT}`,
      token.toLowerCase(),
      String(args.account ?? ""),
      String(args.amount ?? "0"),
      block,
      tx,
      ts,
      chainId,
      logIndex,
      name,
    );
    await insertLogOnce(
      store,
      `INSERT INTO reward_events(token,amount,block,tx,ts,chain_id,log_index,event_kind) VALUES(?,?,?,?,?,?,?,?)
       ${EVENT_IDENTITY_CONFLICT}`,
      token.toLowerCase(),
      String(args.amount ?? "0"),
      block,
      tx,
      ts,
      chainId,
      logIndex,
      name,
    );
    if (claimed || claimRow) {
      sse.publish({ type: "rewards", data: { token, account: args.account, amount: args.amount, tx } });
    }
  }
  if (name === "SelfBurnAccrued" || name === "SelfBurnExecuted") {
    const addr = emitting || token.toLowerCase();
    const burned = await journalEvent(store, { chainId, tx, logIndex, eventKind: name, address: addr, block, ts });
    const burnRow = await insertLogOnce(
      store,
      `INSERT INTO selfburn(token,quote,amount,burned,kind,block,tx,ts,chain_id,log_index,event_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ${EVENT_IDENTITY_CONFLICT}`,
      token.toLowerCase(),
      String(args.quote ?? ""),
      String(args.amount ?? args.quoteIn ?? "0"),
      String(args.burned ?? "0"),
      name,
      block,
      tx,
      ts,
      chainId,
      logIndex,
      name,
    );
    if (burned || burnRow) sse.publish({ type: "burn", data: { token, name, tx } });
  }
  if (name === "FlywheelAccrued" || name === "QuoteSettled") {
    const quote = String(args.quote ?? "").toLowerCase();
    await journalEvent(store, { chainId, tx, logIndex, eventKind: name, address: emitting || quote, block, ts });
    await insertLogOnce(
      store,
      `INSERT INTO flywheel(quote,amount,usdc_in,kind,block,tx,ts,chain_id,log_index,event_kind) VALUES(?,?,?,?,?,?,?,?,?,?)
       ${EVENT_IDENTITY_CONFLICT}`,
      quote,
      String(args.amount ?? "0"),
      String(args.usdcIn ?? "0"),
      name,
      block,
      tx,
      ts,
      chainId,
      logIndex,
      name,
    );
  }
  if (name === "EpochSubmitted") {
    await store.run(
      `INSERT INTO top10_epochs(epoch_id,pot,n,finalized,paused,reason,ts) VALUES(?,?,?,0,0,'',?)
       ON CONFLICT(epoch_id) DO UPDATE SET pot=excluded.pot, n=excluded.n`,
      String(args.epochId ?? "0"),
      String(args.pot ?? "0"),
      Number(args.n ?? 0),
      ts,
    );
    sse.publish({ type: "top10", data: { epochId: args.epochId, pot: args.pot } });
  }
  if (name === "BuybackExecuted" || name === "COREBurned") {
    const quote = String(args.quote ?? "").toLowerCase();
    const bought = await journalEvent(store, { chainId, tx, logIndex, eventKind: name, address: emitting || quote, block, ts });
    const buyRow = await insertLogOnce(
      store,
      `INSERT INTO core_buybacks(quote,quote_in,core_out,block,tx,ts,chain_id,log_index,event_kind) VALUES(?,?,?,?,?,?,?,?,?)
       ${EVENT_IDENTITY_CONFLICT}`,
      quote,
      String(args.quoteIn ?? "0"),
      String(args.coreOut ?? args.amount ?? "0"),
      block,
      tx,
      ts,
      chainId,
      logIndex,
      name,
    );
    if (bought || buyRow) sse.publish({ type: "core", data: { name, tx } });
  }
}
