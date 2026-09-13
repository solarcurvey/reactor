# Read path performance

Catalog and board pages prefer **indexed HTTP**. Independent on-chain views are **batched** after an Arc Multicall3 probe. Live `POST /quote` tickets stay fail-closed and 30s-fresh. Tokenomics, Factory V1, and route scoring are unchanged.

## Inventory (key pages)

| Surface | Before | After |
| --- | --- | --- |
| Home `/` | `GET /markets?limit=80` then chip/q filter in the browser | `useMarketsInfinite` → `GET /markets?q=&board=&cursor_*` (page size 24). Chips are indexer SQL. Featured is `GET /markets?featured=1`. |
| Search `/search` | Loaded the 80-row board, then filtered in the browser | `useMarketsInfinite` → `GET /markets?q=&board=&stage=&cursor_*`. Global catalog, not page-1. |
| Token `/token/:addr` | `GET /markets` (all rows) + `/candles` + `/swaps` + 6 CORE RPCs | `GET /page/token/:addr?interval=` (market + candles + tape in **one** SQL-parallel response). CORE stats stay a batched global query. |
| Launch `/launch` | Sequential registry RPC: `count` → `list(i)` → `get` per quote; ticker `useEffect` fetch | `GET /quote-assets`. Ticker is `useTickerStatus` (TanStack). RPC fallback is two batched waves, not 2N sequential calls. |
| Trade `/trade` + ticket | Board from `/markets`; fee catalog from sequential quote RPC | Board indexed. Fee catalog from cached `/quote-assets`. **`POST /quote` is not cached** (30s client TTL, fail-closed). |
| Quote ecosystem `/quote/:sym` | Full board + sequential quote RPC | Indexed `/markets` + `/quote-assets`. |
| Rewards `/rewards` | After the board loaded, `pendingRewards` **one token at a time** | Indexed board, then one batched `pendingRewards` wave (Multicall3 if verified, else `Promise.all`). |
| Fair `/fair/:id` | On-chain `fairs(id)` **and** the full `/markets` list | `fairs(id)` + `GET /markets/:token` for the auction token. |
| CORE `/core` | `Promise.all` of individual `readContract`s (vesting + buyback) | Same reads, through `readContractsBatched` (probe → multicall or parallel JSON-RPC). |
| THE REACTOR `/reactor` | Indexed `/top10` proxy (#33) | Unchanged. Shared query key. |
| Keeper discovery | Sequential `list`/`get`/`allTokens`/`tokenInfo` | Two-wave batched reads. Writes stay sequential and fenced. |

## Prefer indexed APIs

| Need | Use |
| --- | --- |
| Board / search | `GET /markets` (`q`, `stage`, `quote`, `sort`, keyset) |
| One market | `GET /markets/:token` |
| Token page | `GET /page/token/:token?interval=` — market + candles + swaps, `Promise.all` inside the indexer |
| Quote picker / fee denoms | `GET /quote-assets` |
| Top-10 | `GET /top10` (ValuationService snapshot) |
| Live swap ticket | `POST /quote` only. Do not substitute `/markets` marks. |

RPC remains the fallback when the indexer is empty or down (launch quotes, CORE stats, claimable rewards). Frontend mistakes are reversible; do not invent official 0.30% pools or a second pricer.

## TanStack Query

`createAppQueryClient()` sets 4s `staleTime`, 5m `gcTime`, `retry: 1`, and **`refetchOnWindowFocus: false`** (`EXPENSIVE_REFETCH_ON_FOCUS`). Catalog / CORE / rewards / wallet / token-page / quote-asset reads are expensive. They refresh on an 8–15s interval or after an explicit mutation, not when the tab refocuses. Live `POST /quote` tickets stay in component state with `QUOTE_TTL_MS = 30_000` (`QUOTE_TTL_SEC` on the indexer). A stale ticket re-quotes and refuses submit.

Shared keys live in `apps/web/src/lib/query.ts` (`qk.markets`, `qk.market`, `qk.tokenPage`, `qk.quoteAssets`, `qk.wallet`, `qk.ticketWallet`, …). Rapid search / filter / token / account / ticker / route changes use those keys. Query functions take TanStack `{ signal }` and `fetchIndexerJson` **rethrows `AbortError`** so an obsolete request is cancelled, not stored as `{ ok: false }`.

## Page budgets (CI)

`apps/web/src/lib/page-budget.test.ts` seeds **4,000** indexer markets and runs the same loaders as the UI. HTTP and RPC waves must stay **O(1) or O(page)** (`BOARD_PAGE_SIZE = 80`). The same counts must hold at N=500 and N=4,000. Live `POST /quote` is outside the table. GitHub job **`page-budget`** is a **required** always-on check in `.github/workflows/ci.yml` (every PR, including drafts) and is required by `ci-ok` (skipped ≠ pass). Feature-branch `push` is omitted. The file stays in `pnpm test:lib`.

| Page | HTTP | RPC waves | RPC calls | Max rows |
| --- | ---: | ---: | ---: | ---: |
| Home | 1 | 0 | 0 | 80 |
| Search | 1 | 0 | 0 | 80 |
| Token terminal | 1 | 1 | 6 | 1 |
| Token + ticket wallet | 1 | 2 | 10 | 1 |
| Launch | 2 | 0 | 0 | 32 |
| Rewards | 1 | 1 | 80 | 80 |
| THE REACTOR | 2 | 0 | 0 | 10 |
| CORE | 0 | 2 | 11 | 1 |
| Quote ecosystem | 2 | 0 | 0 | 80 |
| Wallet | 0 | 1 | 3 | 1 |

`rpcWaves` = `readContractsBatched` invocations (one Multicall3 or one `Promise.all`). `rpcCalls` = encoded views inside those waves. Rewards `pendingRewards` is one wave over the **board page**, not the catalog.

## SSE cache (no refetch storm)

`LiveCacheProvider` owns one `EventSource`. `applyLiveEventToClient` **patches** `["markets"]` and `["token-page"]` with `setQueryData`. It must not `invalidateQueries(["markets"])` on each print (that would refetch `/markets` for every trade). `marketsListRefetch` stays `false`. The budget test applies 50 trade events and asserts zero invalidations.

## Batching and Arc Multicall3

`@reactor/core` `readContractsBatched`:

1. `eth_getCode` on canonical Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`.
2. One successful `multicall` marks the chain **verified**.
3. Missing bytecode, revert, or a nonstandard selector marks the chain **absent** and every later call uses `Promise.all` of independent `readContract`s.

Do **not** assume Arc Public Testnet ships Multicall3. Local Anvil 5042002 usually does. Probe before aggregating. Fail-closed routing (`requireProvenPool`, quote `ok: false`) is unchanged.

## Quote freshness / fail-closed (do not weaken)

- `POST /quote` is still one `UserRouteQuoter` eth_call per candidate. Winner is `pickBest`.
- Ticket TTL remains **30 seconds**. Submit after expiry re-quotes; no send on a stale ticket.
- `minOut` 0/1 still refused. SELL `minQuoteOut` is still first-leg quote from the selected preview.
- Indexer marks and `/page/token` are **not** a substitute for a live ticket.

See [Quoting](/docs/quoting), [Markets](/docs/markets), [API](/docs/api).
