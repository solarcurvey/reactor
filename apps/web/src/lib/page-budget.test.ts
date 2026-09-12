/**
 * Machine-checkable page budgets for issue #37.
 *
 * Seeds thousands of indexer markets and drives the same loaders the UI uses.
 * HTTP / RPC waves stay O(1) or O(page) — not O(catalog). Live POST /quote is
 * outside this table.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore, type Store } from "../../../indexer/src/db.ts";
import { listMarkets, getMarket } from "../../../indexer/src/markets-query.ts";
import { aggregateTokenPage } from "../../../indexer/src/page-reads.ts";
import { resetMulticallProbeForTests, type BatchClient } from "./rpc-batch.ts";
import {
  assertWithinBudget,
  BOARD_PAGE_SIZE,
  EXPENSIVE_REFETCH_ON_FOCUS,
  PAGE_BUDGET_INVENTORY,
  PAGE_BUDGET_SCALE,
  PAGE_BUDGETS,
  type PageBudgetName,
  type PageBudgetUsed,
} from "./page-budget.ts";
import {
  loadCorePage,
  loadHomePage,
  loadLaunchPage,
  loadQuoteEcosystem,
  loadReactorPage,
  loadRewardsPage,
  loadSearchPage,
  loadTokenTerminal,
  loadWalletPage,
} from "./page-loads.ts";
import { applyLiveEventToClient } from "./live-cache.ts";
import { createAppQueryClient, qk } from "./query.ts";
import { INDEXER_URL } from "./chain.ts";
import { isAbortError } from "./abort.ts";
import type { LaunchToken } from "./indexed.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function addr(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

const USDC = addr(1);
const ZEC = addr(2);
const FEATURED = addr(0xaa);
const OWNER = addr(0x999);
const CORE = addr(0xc0);
const SPENDER = addr(0x51);
const SUPPLY = (1_000_000_000n * 10n ** 18n).toString();
const DUMMY = { address: CORE, abi: [] as unknown[] };

const libDir = fileURLToPath(new URL(".", import.meta.url));

const counters = {
  http: 0,
  rpcWaves: 0,
  rpcCalls: 0,
  paths: [] as string[],
};
let fetchDelayMs = 0;

function resetCounters() {
  counters.http = 0;
  counters.rpcWaves = 0;
  counters.rpcCalls = 0;
  counters.paths = [];
}

function abortError(): Error {
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function seedQuotes(store: Store) {
  await store.run(
    `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
     VALUES(?,?,?,?,4,1,1,0,0,'',0)`,
    USDC,
    "USDC",
    "USD Coin",
    6,
  );
  await store.run(
    `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
     VALUES(?,?,?,?,0,1,0,1,0,'',0)`,
    ZEC,
    "ZEC",
    "Zcash",
    8,
  );
}

async function seedMarkets(store: Store, from: number, to: number) {
  await store.transaction(async (tx) => {
    for (let i = from; i <= to; i++) {
      const token = addr(i);
      const quote = i % 10 === 0 ? ZEC : USDC;
      const symbol = i <= 119 ? `CAT${String(i - 100).padStart(2, "0")}` : `T${i}`;
      const stage = i % 7 === 0 ? "bonding" : "v4";
      await tx.run(
        `INSERT INTO tokens(address,symbol,name,decimals,creator,quote,mode,rewards_mode,supply,current_supply,ticker,factory_version,created_block,created_tx,created_ts)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        token,
        symbol,
        symbol,
        18,
        OWNER,
        quote,
        0,
        1,
        SUPPLY,
        SUPPLY,
        symbol,
        1,
        i,
        `0x${i.toString(16)}`,
        2_000_000_000 - i,
      );
      await tx.run(
        `INSERT INTO markets(token,quote,pool_id,stage,market_live,fair_id,bonding_bps,real_quote,grad_target,price_quote_x18,price_usd6,fdv_usd6,volume_24h_quote,volume_24h_usd6,trades_24h,lifetime_rewards,image,description,updated_ts)
         VALUES(?,?,?,?,?,?,?,?,?,'1000000000000000','400000','400000000','0','1000000',1,'0','','',?)`,
        token,
        quote,
        "",
        stage,
        stage === "v4" ? 1 : 0,
        "0",
        stage === "bonding" ? 2500 : 0,
        "0",
        "0",
        2_000_000_000 - i,
      );
    }
  });
}

async function seedFeaturedTape(store: Store) {
  const t0 = 1_700_000_000;
  await store.run(
    "INSERT INTO candles(token,interval_sec,t,o,h,l,c,v,n) VALUES(?,?,?,?,?,?,?,?,?)",
    FEATURED,
    300,
    t0,
    "1",
    "2",
    "1",
    "2",
    "10",
    2,
  );
  await store.run(
    "INSERT INTO trades(chain_id,block,tx,log_index,token,quote,side,source,amount_in,amount_out,notional_quote,price_quote_x18,sqrt_price,holders_fee,flywheel_fee,core_fee,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    5042002,
    9,
    "0xfeat",
    0,
    FEATURED,
    USDC,
    "buy",
    "v4",
    "1",
    "2",
    "100",
    "1",
    "0",
    "2",
    "1",
    "0",
    t0,
  );
}

function installFetch(store: Store) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (init?.signal?.aborted) throw abortError();
    if (fetchDelayMs > 0) await sleep(fetchDelayMs, init?.signal);
    if (init?.signal?.aborted) throw abortError();
    counters.http += 1;
    counters.paths.push(`${url.pathname}${url.search}`);
    const path = url.pathname;
    if (path === "/markets") {
      const page = await listMarkets(store, {
        q: url.searchParams.get("q") ?? "",
        stage: url.searchParams.get("stage") ?? "",
        quote: url.searchParams.get("quote") ?? "",
        sort: url.searchParams.get("sort"),
        limit: Number(url.searchParams.get("limit") ?? 40),
        cursorTs: url.searchParams.get("cursor_ts"),
        cursorToken: url.searchParams.get("cursor_token") ?? "",
        offset: Number(url.searchParams.get("offset") ?? 0),
      });
      return jsonRes({ items: page.items, total: page.total, sort: page.sort, next_cursor: page.next_cursor });
    }
    const one = path.match(/^\/markets\/(0x[a-fA-F0-9]{40})$/);
    if (one) {
      const item = await getMarket(store, one[1] ?? "");
      if (!item) return jsonRes({ error: "market not found" }, 404);
      return jsonRes({ item });
    }
    const tokenPage = path.match(/^\/page\/token\/(0x[a-fA-F0-9]{40})$/);
    if (tokenPage) {
      const page = await aggregateTokenPage(store, tokenPage[1] ?? "", {
        interval: url.searchParams.get("interval"),
      });
      if (!page.ok) return jsonRes({ error: page.reason }, 404);
      return jsonRes(page);
    }
    if (path === "/quote-assets") {
      return jsonRes({ items: await store.all("SELECT * FROM quote_assets WHERE enabled=1") });
    }
    if (path === "/top10") {
      return jsonRes({ rows: [], pauseEpoch: false, reason: "" });
    }
    if (path === "/reactor") {
      return jsonRes({ events: [] });
    }
    const ticker = path.match(/^\/ticker\/([^/]+)$/);
    if (ticker) {
      const raw = decodeURIComponent(ticker[1] ?? "");
      return jsonRes({ ticker: raw.toUpperCase(), reserved: raw.toUpperCase() === "CORE", available: raw.toUpperCase() !== "CORE" });
    }
    return jsonRes({ error: `unhandled ${path}` }, 404);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function countingClient(): BatchClient {
  let waveOpen = false;
  return {
    chain: { id: 5042002 },
    getBytecode: async () => undefined,
    readContract: async () => {
      if (!waveOpen) {
        counters.rpcWaves += 1;
        waveOpen = true;
        queueMicrotask(() => {
          waveOpen = false;
        });
      }
      counters.rpcCalls += 1;
      return 1n;
    },
  };
}

type PageUsed = PageBudgetUsed & { name: PageBudgetName };

async function runInventory(store: Store): Promise<PageUsed[]> {
  const client = countingClient();
  const wallet = { owner: OWNER, quote: USDC, spender: SPENDER, payAsset: USDC };
  const used: PageUsed[] = [];

  async function measure(name: PageBudgetName, fn: () => Promise<number>): Promise<void> {
    resetCounters();
    resetMulticallProbeForTests();
    const rows = await fn();
    const snap = {
      http: counters.http,
      rpcWaves: counters.rpcWaves,
      rpcCalls: counters.rpcCalls,
      rows,
    };
    assertWithinBudget(name, snap);
    used.push({ name, ...snap });
  }

  await measure("home", async () => (await loadHomePage()).items.length);
  await measure("search", async () => (await loadSearchPage({ q: "CAT", stage: "v4" })).length);
  await measure("token", async () => {
    const page = await loadTokenTerminal(FEATURED, {
      client,
      core: DUMMY,
      buyback: DUMMY,
      usdc: USDC,
    });
    assert(page.market?.token.toLowerCase() === FEATURED, "featured market");
    return page.market ? 1 : 0;
  });
  await measure("tokenWallet", async () => {
    const page = await loadTokenTerminal(FEATURED, {
      client,
      core: DUMMY,
      buyback: DUMMY,
      usdc: USDC,
      wallet,
    });
    assert(page.wallet != null, "ticket wallet batch");
    return page.market ? 1 : 0;
  });
  await measure("launch", async () => {
    const page = await loadLaunchPage("CAT");
    assert(page.quotes.length >= 2, "quote assets");
    assert(page.tickerStatus.includes("CAT"), "ticker status");
    return page.quotes.length;
  });
  await measure("rewards", async () => (await loadRewardsPage({ account: OWNER, client })).length);
  await measure("reactor", async () => {
    const page = await loadReactorPage();
    return (page.top10.rows ?? []).length;
  });
  await measure("core", async () => {
    await loadCorePage(client, { core: DUMMY, buyback: DUMMY, usdc: USDC, vesting: DUMMY });
    return 1;
  });
  await measure("quoteEcosystem", async () => {
    const page = await loadQuoteEcosystem("ZEC");
    assert(page.quote?.symbol === "ZEC", "ZEC quote");
    return page.items.length;
  });
  await measure("wallet", async () => {
    const snap = await loadWalletPage(client, { owner: OWNER, usdc: USDC, core: CORE, spender: SPENDER });
    assert(snap.usdc === 1n && snap.core === 1n, "wallet snapshot");
    return 1;
  });

  const seen = new Set(used.map((u) => u.name));
  for (const name of PAGE_BUDGET_INVENTORY) {
    assert(seen.has(name), `inventory missing ${name}`);
  }
  return used;
}

function sameBudget(a: PageUsed[], b: PageUsed[]) {
  assert(a.length === b.length, "scale run count");
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    assert(x.name === y.name, "page order");
    assert(x.http === y.http, `${x.name} http grew with catalog ${x.http}→${y.http}`);
    assert(x.rpcWaves === y.rpcWaves, `${x.name} rpcWaves grew with catalog`);
    assert(x.rpcCalls === y.rpcCalls, `${x.name} rpcCalls grew with catalog ${x.rpcCalls}→${y.rpcCalls}`);
  }
}

async function expectAbort(p: Promise<unknown>, label: string) {
  try {
    await p;
    throw new Error(`${label} should have aborted`);
  } catch (e) {
    assert(isAbortError(e), `${label} expected AbortError, got ${e}`);
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "reactor-page-budget-"));
  const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
  const restoreFetch = installFetch(store);

  try {
    assert(INDEXER_URL.startsWith("http"), "indexer url");
    await seedQuotes(store);
    await seedMarkets(store, 100, 599);
    await seedFeaturedTape(store);
    const n500 = Number((await store.get<{ n: number }>("SELECT COUNT(*) as n FROM markets"))?.n ?? 0);
    assert(n500 === 500, `first seed ${n500}`);

    const at500 = await runInventory(store);

    await seedMarkets(store, 600, 4099);
    const n4000 = Number((await store.get<{ n: number }>("SELECT COUNT(*) as n FROM markets"))?.n ?? 0);
    assert(n4000 === PAGE_BUDGET_SCALE, `scale seed ${n4000} !== ${PAGE_BUDGET_SCALE}`);

    const at4000 = await runInventory(store);
    sameBudget(at500, at4000);

    const home = at4000.find((u) => u.name === "home")!;
    const rewards = at4000.find((u) => u.name === "rewards")!;
    assert(home.http === 1 && home.rpcWaves === 0, "home is one indexed GET");
    assert(home.rows === BOARD_PAGE_SIZE, "home is O(page) rows");
    assert(rewards.rpcCalls === BOARD_PAGE_SIZE, "rewards pendingRewards is O(page) not O(catalog)");
    assert(rewards.rpcCalls !== n4000, "rewards must not walk the catalog");

    {
      fetchDelayMs = 30;
      const a = new AbortController();
      const b = new AbortController();
      const c = new AbortController();
      const searchA = loadSearchPage({ q: "aa" }, a.signal);
      const searchB = loadSearchPage({ q: "bb", stage: "bonding" }, b.signal);
      const searchC = loadSearchPage({ q: "CAT", stage: "v4" }, c.signal);
      const tokenA = loadTokenTerminal(addr(101), { signal: a.signal });
      const tokenC = loadTokenTerminal(FEATURED, { signal: c.signal });
      const launchA = loadLaunchPage("AAA", a.signal);
      const launchC = loadLaunchPage("CAT", c.signal);
      const staleWallet = new AbortController();
      staleWallet.abort();
      const acctA = loadWalletPage(countingClient(), {
        owner: addr(0x111),
        usdc: USDC,
        core: CORE,
        spender: SPENDER,
        signal: staleWallet.signal,
      });
      const reactorA = loadReactorPage(a.signal);
      const reactorC = loadReactorPage(c.signal);
      a.abort();
      b.abort();
      await expectAbort(searchA, "search aa");
      await expectAbort(searchB, "search bb");
      await expectAbort(tokenA, "token 101");
      await expectAbort(launchA, "ticker AAA");
      await expectAbort(acctA, "wallet other account");
      await expectAbort(reactorA, "reactor stale route");
      const lastSearch = await searchC;
      const lastToken = await tokenC;
      const lastLaunch = await launchC;
      const lastReactor = await reactorC;
      assert(lastSearch.length <= BOARD_PAGE_SIZE && lastSearch.length > 0, "last search wins");
      assert(lastToken.market?.token.toLowerCase() === FEATURED, "last token wins");
      assert(lastLaunch.tickerStatus.includes("CAT"), "last ticker wins");
      assert(Array.isArray(lastReactor.events.events), "last reactor route wins");
      fetchDelayMs = 0;
    }

    {
      const qc = createAppQueryClient();
      qc.setDefaultOptions({ queries: { gcTime: 0 } });
      const board: LaunchToken[] = [
        {
          token: FEATURED,
          quote: USDC,
          creator: OWNER,
          mode: 0,
          poolId: "0x",
          marketLive: true,
          fairId: 0n,
          name: "CAT",
          symbol: "CAT",
          decimals: 18,
          supply: 1n,
          image: "",
          description: "",
          website: "",
          twitter: "",
          telegram: "",
          volume24hUsd6: "100",
          priceQuoteX18: "1",
        },
      ];
      qc.setQueryData(qk.markets({ limit: BOARD_PAGE_SIZE }), board);
      qc.setQueryData(qk.tokenPage(FEATURED, "5m"), { market: board[0], swaps: [] });
      let invalidates = 0;
      const origInvalidate = qc.invalidateQueries.bind(qc);
      qc.invalidateQueries = ((...args: Parameters<typeof origInvalidate>) => {
        invalidates += 1;
        return origInvalidate(...args);
      }) as typeof qc.invalidateQueries;
      for (let i = 0; i < 50; i++) {
        const r = applyLiveEventToClient(qc, {
          type: "trade",
          data: { token: FEATURED, notional: "1", px: String(i + 2) },
        });
        assert(r.marketsListRefetch === false, "SSE must not schedule a board refetch");
      }
      assert(invalidates === 0, `SSE invalidateQueries storm (${invalidates})`);
      const patched = qc.getQueryData<LaunchToken[]>(qk.markets({ limit: BOARD_PAGE_SIZE }));
      assert(patched?.[0]?.volume24hUsd6 === "150", "SSE patches volume in place");
      const liveSrc = readFileSync(join(libDir, "live-cache.ts"), "utf8");
      assert(!liveSrc.includes("invalidateQueries("), "live-cache must patch, not invalidate");
      assert(liveSrc.includes("marketsListRefetch: false"), "explicit no-refetch result");
      qc.clear();
    }

    {
      assert(EXPENSIVE_REFETCH_ON_FOCUS === false, "focus policy constant");
      const qc = createAppQueryClient();
      assert(qc.getDefaultOptions().queries?.refetchOnWindowFocus === false, "QueryClient default");
      const hooks = readFileSync(join(libDir, "hooks.ts"), "utf8");
      const query = readFileSync(join(libDir, "query.ts"), "utf8");
      const core = readFileSync(join(libDir, "../app/core/page.tsx"), "utf8");
      const reactor = readFileSync(join(libDir, "../app/reactor/page.tsx"), "utf8");
      const indexed = readFileSync(join(libDir, "indexed.ts"), "utf8");
      assert(!hooks.includes("refetchOnWindowFocus: true"), "hooks do not opt into focus refetch");
      assert(!core.includes("refetchOnWindowFocus: true"), "CORE page");
      assert(!reactor.includes("refetchOnWindowFocus: true"), "REACTOR page");
      assert(hooks.includes("EXPENSIVE_REFETCH_ON_FOCUS"), "hooks bind the policy");
      assert(query.includes("EXPENSIVE_REFETCH_ON_FOCUS"), "query client binds the policy");
      assert(hooks.includes("{ signal }") || hooks.includes("({ signal })"), "TanStack signal passed");
      assert(indexed.includes('e.name === "AbortError") throw e'), "abort is not swallowed as ok:false");
      assert(hooks.includes("qk.markets(opts)"), "search/filter key");
      assert(hooks.includes("qk.tokenPage"), "token route key");
      assert(hooks.includes("qk.wallet"), "account wallet key");
      assert(hooks.includes("qk.ticketWallet"), "ticket account key");
      assert(hooks.includes("qk.rewards"), "rewards account key");
      assert(hooks.includes("qk.ticker"), "ticker key");
      qc.clear();
    }

    {
      const ciYml = readFileSync(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8");
      const trigger = ciYml.split("jobs:")[0] ?? "";
      assert(/name:\s*page-budget/.test(ciYml), "visible GitHub job page-budget");
      assert(ciYml.includes("test:page-budget") || ciYml.includes("page-budget.test.ts"), "job runs this file");
      assert(trigger.includes("pull_request"), "page-budget runs on pull_request");
      assert(
        !/on:\s*\n\s+push:\s*\n\s+pull_request:/.test(trigger),
        "do not copy docs-sync push+pull_request pair (Refs #69/#73)",
      );
    }

    console.log(
      `page-budget ok: catalog=${n4000} pages=${at4000.map((u) => `${u.name}:${u.http}h/${u.rpcWaves}w/${u.rpcCalls}c`).join(" ")}`,
    );
  } finally {
    restoreFetch();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
