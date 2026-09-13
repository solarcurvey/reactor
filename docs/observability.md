# Observability

> Protocol **0.3.4**. Frontend ops only. Economics, Factory V1, and on-chain architecture are unchanged. Not audited. No public mainnet.

Production web emits **failure telemetry** (not a product analytics warehouse), **core-page Web Vitals**, and **error boundaries** so a single route cannot white-screen the app.

Issue **#39 stays open** until merge + post-merge verify (including a configured telemetry release that symbolicates a deliberate production error). Later branches must rebase onto **0.3.4** (this branch owns the protocol number) unless AutomationGateway **#54** (`0.4.0`) lands first — then rebase onto that tip and **do not restore 0.3.4**. Do not restore **0.3.3**.

## What is shipped

| Surface | Behavior |
| --- | --- |
| Release identity | Every event carries `reactor@{protocolVersion}+{git SHA}` **and** exact `reactorEnv`, `chainId`, `chainName`, `buildTimestamp`. `GET /api/version` and `<meta>` / `data-*` markers expose the same tags. No secrets. |
| Sentry-or-equivalent | Optional. Set `SENTRY_DSN` (server) and/or `NEXT_PUBLIC_SENTRY_DSN` (public). Events are POSTed to Sentry's store API after redaction, including symbolicated `exception.stacktrace.frames` when first-party resolve ran. Local/CI no-ops without a DSN. Configured-DSN proof: `obs/vendor-proof.test.ts` (in-process store mock). |
| Source maps | `REACTOR_SOURCEMAPS=1` or `SENTRY_AUTH_TOKEN` generates hidden browser maps at build. Production middleware **404s** `*.map`. First-party symbolication (`obs/sourcemap.ts`) resolves a generated stack back to original source and records exact `release` / `reactorEnv` / `chainId` / `buildTimestamp`. Archive + optional Sentry: `tsx scripts/upload-sourcemaps.ts`. `REACTOR_SOURCEMAPS_REQUIRE=1` fails closed if maps are missing (no silent no-op). |
| Ingest | Browser → `POST /api/telemetry` (16KiB JSON cap). Production rate-limit is **40 POSTs / 10s / IP**; review-fixture artifacts and `REACTOR_TELEMETRY_RELAXED=1` raise the cap so parallel Playwright does not starve ingest. A **429** is intended backpressure: the browser does not retry onto a public DSN, and Chromium's `Failed to load resource` for `/api/telemetry` is not a page bug (`web-qa` console-gate ignores only that URL). Quote `?inject=quote-429` stays fail-visible. Server re-redacts and drops residual secrets. |
| Error boundaries | App (`app/error.tsx` + client `AppErrorBoundary`), root (`global-error.tsx`), and per-route `error.tsx` (trade, launch, token, reactor, core, rewards, wallet, quote, fair, docs, ops, search). |
| Web Vitals | First-party `PerformanceObserver` on core pages (`/`, `/trade`, `/launch`, `/token/*`, `/reactor`, `/core`). Kind `perf`. Budgets: LCP 2500ms, INP 200ms, CLS 0.1, FCP 1800ms, TTFB 800ms. |
| Correlation | Every failure has `traceId` (sent as `x-request-id`). User-visible request/tx errors show `ref {traceId} · chain {chainId}`. Match that string to BFF ingest, indexer logs, and optional Sentry tags. |

## Instrumented failures

Kinds: `api` · `rpc` · `wallet` · `quote` · `sse` · `tx` · `media` · `ui` · `simulation` · `perf` · `release`.

| Kind | Where |
| --- | --- |
| `api` | Indexer board/health/candles/swaps, launch authorize BFF, Top-10 API, ticker |
| `rpc` | Quote-asset / CORE reads |
| `wallet` | Connect / switch chain. Expected EIP-1193 `4001` is recorded and **never pages** |
| `quote` | `POST /quote` ticket HTTP / API failures |
| `sse` | `GET /stream` disconnect |
| `tx` | Trade, graduate, claim, launch submits |
| `media` | `POST /upload` |
| `ui` | Error boundaries (render outage class) |
| `simulation` | Quote / RPC / tx text that is `eth_call`, preview revert, or execution reverted |
| `perf` | Core-page Web Vitals (not an outage class) |

Identical events are deduped for 8 seconds so a down indexer does not flood.

## Exact environment / chain tags

Assert these fields on every event and on `GET /api/version` — not only the `reactor@{protocol}+{SHA}` string:

| Field | Local default |
| --- | --- |
| `protocolVersion` | `0.3.4` |
| `release` | `reactor@0.3.4+{SHA}` |
| `env` | lowercase (`local` / `test` / `production`) |
| `reactorEnv` | `LOCAL` · `TESTNET` · `PROD` · `TEST` |
| `chainId` | `5042002` |
| `chainName` | `REACTOR local (Arc-compatible)` (or `Arc Public Testnet` when claimed) |
| `buildTimestamp` | ISO-8601 from `NEXT_PUBLIC_BUILD_TIME` (inlined at Next build) |
| `factoryVersion` | `1` |

## Operator alert thresholds (runbook)

Outage classes that may page: **render · api · rpc · quote · sse · simulation**.

| Class | Count in window | Window | Consecutive |
| --- | ---: | ---: | ---: |
| render | 3 | 5 min | 2 |
| api | 5 | 2 min | 3 |
| rpc | 5 | 2 min | 3 |
| quote | 8 | 2 min | 5 |
| sse | 4 | 3 min | 3 |
| simulation | 5 | 2 min | 3 |

**Do not page** on:

- Expected wallet **4001** / `UserRejectedRequestError` / “user rejected the request”
- A single quote miss or a lone UI boundary
- `perf` over-budget samples (dashboards only)
- `tx` / `media` / `wallet` that are not mapped to an outage class

### Runbook

1. Read the user-visible `ref {traceId} · chain {chainId}` (trade, launch, fair, error boundary).
2. Search BFF `reactor-web-ingest` / Sentry `trace_id` / indexer `x-request-id` for that id.
3. Confirm `release`, `buildTimestamp`, `reactorEnv`, and `chainId` match the build the user has (`GET /api/version`).
4. Page only when `page: true` (threshold crossed). A lone 4001 is operator noise — ignore.
5. Render class: route `error.tsx` digest + release SHA. Other routes keep trading.
6. API / RPC / quote / SSE / simulation: indexer health, RPC head, `/quote`, `/stream`. Fail closed — do not invent marks.

Encoded in `apps/web/src/lib/obs/alerts.ts` and shown on `/ops`.

## Troubleshooting correlation

| User sees | Backend / chain join |
| --- | --- |
| `ref abcdef0123456789 · chain 5042002` | `x-request-id: abcdef0123456789` on indexer / BFF; telemetry `traceId` |
| Trade / launch / fair error | Same `traceId` on the `quote` / `tx` / `api` event |
| `tx 0xabc12345…def678` | Truncated hash (32-byte hex is never shipped in full) |
| Route boundary digest | `ui` event `extra.digest` + release SHA |

This is **not** an on-chain oracle. Correlation is operator-trusted log join.

## Privacy (mandatory)

Telemetry **must not** contain:

- Private keys, seed phrases, JWT, `Bearer` / `Basic` credentials
- Turnstile tokens, `OPS_TOKEN`, partner keys, cookies
- EIP-712 / launch **signatures** (65-byte hex)
- URL userinfo or secret query params (`turnstile`, `signature`, `ops`, …)

32-byte hex (`0x` + 64) is truncated (`0xabc12345…def678`) so a leaked key is not replayable and a tx hash is still correlatable. ERC-20 addresses stay (they are on-chain public). Client redacts; the BFF redacts again and **rejects** payloads that still look like secrets.

Production failure-injection (unit + Playwright `next start` `/obs-inject` with `NEXT_PUBLIC_REVIEW_FIXTURES=1`) proves every outage-class hook (render / api / rpc / quote / sse / simulation) fires while Anvil #0 key, BIP39 mnemonic, and 65-byte signature sentinels stay redacted. The same production server records core-page `perf` on `/trade` and shows the six-class runbook on `/ops`.

This is **not** an on-chain oracle, not a session recorder, and not custody telemetry. Operators who enable Sentry are trusting that vendor with redacted failure text. See [Trust](/docs/trust).

## Operator env

```
NEXT_PUBLIC_BUILD_SHA=          # default: git HEAD at build
NEXT_PUBLIC_BUILD_TIME=         # ISO-8601; default: build clock
NEXT_PUBLIC_CHAIN_ID=5042002
NEXT_PUBLIC_CHAIN_NAME=REACTOR local (Arc-compatible)
SENTRY_DSN=                     # server forward (preferred)
NEXT_PUBLIC_SENTRY_DSN=         # browser fallback if BFF is down
SENTRY_AUTH_TOKEN=              # source map upload only
SENTRY_ORG=
SENTRY_PROJECT=
REACTOR_SOURCEMAPS=1            # generate maps without uploading
```

`GET /api/version` reports `sentry`, `buildSha`, `release`, `reactorEnv`, `chainId`, `chainName`, `buildTimestamp`. Never mainnet. Never audited.

LOCAL-only preview: `/error-preview` (button or `?preview=1`) trips a route boundary after mount. `/obs-inject` injects outage classes with secret sentinels. Both stay hidden in genuine production; `/obs-inject` is available on a production **build** only when `NEXT_PUBLIC_REVIEW_FIXTURES=1` (CI / `pnpm test:obs`).

## Configured vendor / staging proof

Public-fork CI has **no** Sentry org token (contents:read, no secrets). The configured-DSN path is still proven:

1. A deliberate production throw (`deliberate-obs-probe`) is compiled and run.
2. First-party VLQ resolve maps the generated frame to `obs-probe.ts:2`.
3. `reportFailure` attaches `resolvedFrames` + exact `release` / `reactorEnv` / `chainId` / `buildTimestamp`.
4. `postSentryStore` POSTs that event to a **valid DSN** whose store is an in-process mock (`obs/vendor-proof.test.ts`). The receipt must include:
   - `release` = `reactor@0.3.4+{SHA}`
   - tags `reactor_env=LOCAL`, `chain_id=5042002`, `chain_name=REACTOR local (Arc-compatible)`, `build_time` ISO
   - `exception.values[0].stacktrace.frames[].filename` = `obs-probe.ts` (not only the generated chunk)

That is the **documented staging vendor proof**. Same payload shape as a real Sentry store.

### Live staging / post-merge checklist (closes #39 only after merge)

Do this against an operator-owned staging Sentry (or equivalent). Do not put the token in the repo.

1. Set `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
2. `REACTOR_SOURCEMAPS=1 NEXT_PUBLIC_REVIEW_FIXTURES=1 pnpm --filter web build`
3. `tsx scripts/upload-sourcemaps.ts` (archive + vendor upload). `REACTOR_SOURCEMAPS_REQUIRE=1` if maps must exist.
4. `pnpm --filter web exec next start` and trip `/error-preview?preview=1` or `/obs-inject` render.
5. In the vendor UI, open the issue for `deliberate-obs-probe` / the route-boundary error. Confirm the **same** release / env / chain tags and a symbolicated original filename (not only `*.js` chunks).

#39 stays open until that live verify after merge.

## Merge train

This branch **owns protocol 0.3.4**. Parent is `4207356` (#75 Restricted-access UX after #44 E2E release gate / #70 sanctions freshness / #79 CI evidence / #68 operator-policy / #67 geo / #66 OFAC / #49 UI QA / #42 full GitHub CI extras / #50 indexed board + page-budget / #58 typecheck / #73 three-tier CI / #77 / #76 / #74 / #59 / #47). `#75` `/restricted` + `policy.ensureProof` stay. Recovered-wallet proof stays on Launch/trade. #44 `e2e-release-gate` + sanctions ops docs/nav and `/ops` dataset card stay from main. Lands independently before docs PR #48; do not fold handbook work here. Visible CI gate: `.github/workflows/ci.yml` job **`obs-ui`** (full / main / `ci-full`; obs unit + source-map + configured-DSN vendor proof + production `next start` Playwright `obs-failure-injection.spec.ts`; `contents: read` + `persist-credentials: false`). Fast PR runs obs units via `test:lib`. Close #39 only after merge + post-merge live vendor verify. If #54 AutomationGateway `0.4.0` merges first, rebase onto that tip and do not restore 0.3.4. Do not restore 0.3.3 in `docs/version.json` / root `package.json`.
