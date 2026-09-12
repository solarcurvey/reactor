import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import {
  applyOnchainTotalSupply,
  applyTokenLevelBurn,
  currentSupplyRaw,
  persistSupplyBurn,
  reconcileCurrentSupplies,
  rollOneMarket,
  upsertMarket,
  upsertToken,
} from "./ingest.ts";
import { persistTokenBurnLogs } from "./tick-persist.ts";
import { fdvUsd6 } from "../../../packages/reactor/src/prices.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "reactor-fdv-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });

const TOKEN = "0x1111111111111111111111111111111111110001";
const CORE = "0x2222222222222222222222222222222222220002";
const USDC = "0x0000000000000000000000000000000000000006";
const INITIAL = 1_000_000_000n * 10n ** 18n;
const BURN = 100_000_000n * 10n ** 18n;
const HOLDER_BURN = 40_000_000n * 10n ** 18n;
const PX = 2n * 10n ** 18n;
const now = 1_700_000_000;
const CHAIN = 1;

await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  USDC,
  "USDC",
  "USD Coin",
  6,
  0,
  1,
  1,
  0,
  0,
  "",
  0,
);

await upsertToken(store, {
  address: TOKEN,
  symbol: "CAT",
  name: "Cat",
  decimals: 18,
  quote: USDC,
  supply: INITIAL.toString(),
  ts: now,
});
await upsertMarket(store, { token: TOKEN, quote: USDC, stage: "v4", marketLive: true, ts: now });
await store.run("UPDATE markets SET price_quote_x18=? WHERE token=?", PX.toString(), TOKEN);
await rollOneMarket(store, TOKEN, now);

const expectedFull = fdvUsd6(PX, INITIAL, 18, 1_000_000n);
const before = await store.get<{ fdv_usd6: string; price_usd6: string }>(
  "SELECT fdv_usd6, price_usd6 FROM markets WHERE token=?",
  TOKEN,
);
assert(before?.price_usd6 === (2_000_000n).toString(), `price_usd6 ${before?.price_usd6}`);
assert(before?.fdv_usd6 === expectedFull.toString(), `pre-burn fdv ${before?.fdv_usd6}`);
assert((await currentSupplyRaw(store, TOKEN)) === INITIAL, "current supply starts at TokenCreated");

{
  await persistSupplyBurn(store, {
    token: TOKEN,
    quote: USDC,
    amount: "0",
    burned: BURN.toString(),
    kind: "SelfBurnExecuted",
    block: 2,
    tx: "0xproto1",
    ts: now + 10,
    chainId: CHAIN,
    logIndex: 1,
  });
  await persistSupplyBurn(store, {
    token: TOKEN,
    quote: USDC,
    amount: "1",
    burned: "0",
    kind: "SelfBurnAccrued",
    block: 3,
    tx: "0xaccrue",
    ts: now + 11,
    chainId: CHAIN,
    logIndex: 2,
  });
  await rollOneMarket(store, TOKEN, now + 12);
  const onlyProto = await store.get<{ fdv_usd6: string }>("SELECT fdv_usd6 FROM markets WHERE token=?", TOKEN);
  assert(onlyProto?.fdv_usd6 === expectedFull.toString(), "protocol SelfBurn attribution must not write current_supply");
}

{
  // (1) direct holder ReactorToken.burn() — Transfer-to-zero / Burned, no protocol event
  const applied = await applyTokenLevelBurn(store, {
    token: TOKEN,
    burned: HOLDER_BURN.toString(),
    account: "0xholder",
    block: 4,
    tx: "0xholder-burn",
    ts: now + 20,
    chainId: CHAIN,
    logIndex: 3,
    eventKind: "Burned",
  });
  assert(applied, "direct ReactorToken.burn() is indexed");
  await rollOneMarket(store, TOKEN, now + 21);
  const afterHolder = await store.get<{ fdv_usd6: string }>("SELECT fdv_usd6 FROM markets WHERE token=?", TOKEN);
  const remaining = INITIAL - HOLDER_BURN;
  const honest = fdvUsd6(PX, remaining, 18, 1_000_000n);
  assert(afterHolder?.fdv_usd6 === honest.toString(), `holder burn fdv ${afterHolder?.fdv_usd6} want ${honest}`);
  assert(afterHolder?.fdv_usd6 !== expectedFull.toString(), "holder burn must drop USD FDV");
  assert((await currentSupplyRaw(store, TOKEN)) === remaining, "holder burn lowers current_supply");
  const tok = await store.get<{ supply: string }>("SELECT supply FROM tokens WHERE address=?", TOKEN);
  assert(tok?.supply === INITIAL.toString(), "TokenCreated supply stays frozen");
  const protocolKinds = await store.all<{ burned: string }>(
    `SELECT burned FROM selfburn WHERE token=? AND kind IN ('SelfBurnExecuted','Top10Buy','COREBurned')`,
    TOKEN,
  );
  let protocolSum = 0n;
  for (const r of protocolKinds) protocolSum += BigInt(r.burned || "0");
  assert(protocolSum === BURN, "holder TokenBurned is not a protocol-event kind");
  const naiveFromProtocol = INITIAL - protocolSum;
  assert(remaining !== naiveFromProtocol, "FDV must not use TokenCreated minus SelfBurn/Top10");
  assert(
    afterHolder?.fdv_usd6 !== fdvUsd6(PX, naiveFromProtocol, 18, 1_000_000n).toString(),
    "protocol-only remaining supply would leave FDV stale after public burn()",
  );
  const snapped = await currentSupplyRaw(store, TOKEN);
  await persistSupplyBurn(store, {
    token: TOKEN,
    quote: USDC,
    amount: "0",
    burned: BURN.toString(),
    kind: "SelfBurnExecuted",
    block: 4,
    tx: "0xproto-after-holder",
    ts: now + 22,
    chainId: CHAIN,
    logIndex: 4,
  });
  await rollOneMarket(store, TOKEN, now + 23);
  assert((await currentSupplyRaw(store, TOKEN)) === snapped, "rollOneMarket must not write current_supply");
}

{
  // (2) protocol Top10 + token Transfer-to-zero + Burned in the same tx — two logs, totalSupply corrects
  await persistSupplyBurn(store, {
    token: TOKEN,
    quote: "",
    amount: "50",
    burned: BURN.toString(),
    kind: "Top10Buy",
    block: 5,
    tx: "0xsame-tx",
    ts: now + 30,
    chainId: CHAIN,
    logIndex: 5,
  });
  const transfer = await applyTokenLevelBurn(store, {
    token: TOKEN,
    burned: BURN.toString(),
    account: "0xvault",
    block: 5,
    tx: "0xsame-tx",
    ts: now + 30,
    chainId: CHAIN,
    logIndex: 6,
    eventKind: "Transfer",
  });
  const burnedEvt = await applyTokenLevelBurn(store, {
    token: TOKEN,
    burned: BURN.toString(),
    account: "0xvault",
    block: 5,
    tx: "0xsame-tx",
    ts: now + 30,
    chainId: CHAIN,
    logIndex: 7,
    eventKind: "Burned",
  });
  assert(transfer && burnedEvt, "Transfer and Burned are distinct (chain_id,tx,log_index,event_kind) rows");
  const undercounted = INITIAL - HOLDER_BURN - 2n * BURN;
  assert((await currentSupplyRaw(store, TOKEN)) === undercounted, "same-tx Transfer+Burned may decrement twice");
  const honest = INITIAL - HOLDER_BURN - BURN;
  await reconcileCurrentSupplies(store, async (addr) => (addr.toLowerCase() === TOKEN ? honest : null), {
    priority: [TOKEN],
  });
  await rollOneMarket(store, TOKEN, now + 31);
  const afterOnce = await store.get<{ fdv_usd6: string }>("SELECT fdv_usd6 FROM markets WHERE token=?", TOKEN);
  assert((await currentSupplyRaw(store, TOKEN)) === honest, "totalSupply() corrects Transfer+Burned double count");
  assert(afterOnce?.fdv_usd6 === fdvUsd6(PX, honest, 18, 1_000_000n).toString(), "FDV uses reconciled remaining supply");
}

{
  // (3) restart / missed attribution — onchain totalSupply() is the corrector
  await upsertToken(store, {
    address: "0x1111111111111111111111111111111111110003",
    symbol: "MIS",
    quote: USDC,
    supply: INITIAL.toString(),
    ts: now,
  });
  const missed = "0x1111111111111111111111111111111111110003";
  await upsertMarket(store, { token: missed, quote: USDC, stage: "v4", marketLive: true, ts: now });
  await store.run("UPDATE markets SET price_quote_x18=? WHERE token=?", PX.toString(), missed);
  await rollOneMarket(store, missed, now);
  assert((await currentSupplyRaw(store, missed)) === INITIAL, "missed burns leave stale current_supply");
  const chain = new Map<string, bigint>([[missed, INITIAL - BURN]]);
  const rec = await reconcileCurrentSupplies(store, async (addr) => chain.get(addr.toLowerCase()) ?? null, {
    priority: [missed],
    limit: 10,
  });
  assert(rec.reconciled >= 1, "backfill used onchain totalSupply");
  await rollOneMarket(store, missed, now + 40);
  const fixed = await store.get<{ fdv_usd6: string }>("SELECT fdv_usd6 FROM markets WHERE token=?", missed);
  assert((await currentSupplyRaw(store, missed)) === INITIAL - BURN, "reconcile matches totalSupply after missed events");
  assert(fixed?.fdv_usd6 === fdvUsd6(PX, INITIAL - BURN, 18, 1_000_000n).toString(), "restart/backfill FDV corrected");
}

{
  // (4) CORE: CoreToken.burn() is Transfer-to-zero only; current_supply must match totalSupply()
  await upsertToken(store, { address: CORE, symbol: "CORE", supply: INITIAL.toString(), ts: now });
  const coreOnchain = INITIAL - 25_000_000n * 10n ** 18n;
  await persistSupplyBurn(store, {
    token: CORE,
    burned: "1",
    kind: "COREBurned",
    quote: USDC,
    amount: "0",
    block: 9,
    tx: "0xcore-attr",
    ts: now + 50,
    chainId: CHAIN,
    logIndex: 9,
  });
  assert((await currentSupplyRaw(store, CORE)) === INITIAL, "COREBurned attribution does not invent supply");
  const coreDelta = INITIAL - coreOnchain;
  assert(
    await applyTokenLevelBurn(store, {
      token: CORE,
      burned: coreDelta.toString(),
      account: "0xkeeper",
      block: 10,
      tx: "0xcore-transfer-zero",
      ts: now + 51,
      chainId: CHAIN,
      logIndex: 10,
      eventKind: "Transfer",
    }),
    "CoreToken Transfer-to-zero is a token-level burn",
  );
  assert((await currentSupplyRaw(store, CORE)) === coreOnchain, "CORE Transfer-to-zero lowers current_supply");
  await applyOnchainTotalSupply(store, CORE, coreOnchain);
  assert((await currentSupplyRaw(store, CORE)) === coreOnchain, "CORE current_supply matches CoreToken.totalSupply()");
  const chain = new Map<string, bigint>([[CORE, coreOnchain]]);
  await reconcileCurrentSupplies(store, async (addr) => chain.get(addr.toLowerCase()) ?? null, { priority: [CORE] });
  assert((await currentSupplyRaw(store, CORE)) === coreOnchain, "CORE reconcile is stable");
}

{
  // Replay of the same log is a no-op; totalSupply() remains SoT.
  const multi = "0x1111111111111111111111111111111111110004";
  await upsertToken(store, { address: multi, symbol: "MUL", quote: USDC, supply: INITIAL.toString(), ts: now });
  const first = await applyTokenLevelBurn(store, {
    token: multi,
    burned: BURN.toString(),
    account: "0xa",
    block: 11,
    tx: "0xmulti-burn",
    ts: now + 60,
    chainId: CHAIN,
    logIndex: 11,
    eventKind: "Transfer",
  });
  const replay = await applyTokenLevelBurn(store, {
    token: multi,
    burned: BURN.toString(),
    account: "0xa",
    block: 11,
    tx: "0xmulti-burn",
    ts: now + 60,
    chainId: CHAIN,
    logIndex: 11,
    eventKind: "Transfer",
  });
  assert(first && !replay, "canonical identity replay does not decrement twice");
  const secondLog = await applyTokenLevelBurn(store, {
    token: multi,
    burned: BURN.toString(),
    account: "0xb",
    block: 11,
    tx: "0xmulti-burn",
    ts: now + 60,
    chainId: CHAIN,
    logIndex: 12,
    eventKind: "Transfer",
  });
  assert(secondLog, "a second log in the same tx is a distinct identity");
  const onchain = INITIAL - 2n * BURN;
  await applyOnchainTotalSupply(store, multi, onchain);
  assert((await currentSupplyRaw(store, multi)) === onchain, "totalSupply() wins over event attribution");
}

{
  // Log path: Burned + Transfer-to-zero through persistTokenBurnLogs (canonical identity).
  const viaLogs = "0x1111111111111111111111111111111111110005";
  const ZERO = "0x0000000000000000000000000000000000000000";
  await upsertToken(store, { address: viaLogs, symbol: "LOG", quote: USDC, supply: INITIAL.toString(), ts: now });
  const first = await persistTokenBurnLogs(store, {
    chainId: CHAIN,
    timestamps: new Map([[12, now + 70]]),
    logs: [
      {
        eventName: "Transfer",
        args: { from: "0xholder", to: ZERO, amount: HOLDER_BURN.toString() },
        address: viaLogs,
        blockNumber: 12n,
        transactionHash: "0xlog-burn",
        logIndex: 20,
      },
      {
        eventName: "Burned",
        args: { account: "0xholder", amount: HOLDER_BURN.toString() },
        address: viaLogs,
        blockNumber: 12n,
        transactionHash: "0xlog-burn",
        logIndex: 21,
      },
    ],
  });
  assert(first.burned.includes(viaLogs), "token burn logs are applied");
  assert((await currentSupplyRaw(store, viaLogs)) === INITIAL - 2n * HOLDER_BURN, "Transfer and Burned are two identities");
  const replay = await persistTokenBurnLogs(store, {
    chainId: CHAIN,
    timestamps: new Map([[12, now + 70]]),
    logs: [
      {
        eventName: "Transfer",
        args: { from: "0xholder", to: ZERO, amount: HOLDER_BURN.toString() },
        address: viaLogs,
        blockNumber: 12n,
        transactionHash: "0xlog-burn",
        logIndex: 20,
      },
    ],
  });
  assert(replay.burned.length === 0, "canonical (chain_id,tx,log_index,event_kind) replay is a no-op");
  assert((await currentSupplyRaw(store, viaLogs)) === INITIAL - 2n * HOLDER_BURN, "replay does not decrement twice");
  const honest = INITIAL - HOLDER_BURN;
  await reconcileCurrentSupplies(store, async (addr) => (addr.toLowerCase() === viaLogs ? honest : null), {
    priority: [viaLogs],
  });
  assert((await currentSupplyRaw(store, viaLogs)) === honest, "totalSupply() corrects same-tx Transfer+Burned via log path");
}

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("burn-adjusted valuation tests ok");
