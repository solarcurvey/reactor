# BUILD REPORT — Protocol 0.2.0 P0 correctness + Arc deployability

**Status:** Continue on existing REACTOR Origin repo. Parent `d3081d1`. Local Anvil 5042002 + Arc Public Testnet probe only.  
**Not audited. Not mainnet. Arc Public Testnet Factory create not claimed.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Branch | `cursor/p0-admission-arc-docs-9bf9` |
| Parent | `d3081d1` |
| Protocol release | **0.2.0** (`docs/version.json`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | P0 admission, full EIP-712 identity, Factory EIP-170 split, RouteGraph quotes, indexer/keeper, docs + UI |
| Mainnet | **Blocked** |

## EIP-170 sizes (`forge build --sizes`, optimizer 200, via_IR)

| Contract | Creation (bytes) | Runtime (bytes) | EIP-170 24576 | Margin gate (≤23552) |
| --- | ---: | ---: | --- | --- |
| ReactorFactory | 25409 | **23280** | under | pass |
| InstantLaunchModule | 17627 | 17037 | under | pass |
| InstantCurve | 19644 | 18960 | under | pass |
| ReactorHook | 11813 | 10952 | under | pass |
| TickerRegistry | 5655 | 4760 | under | pass |

Arc / Ethereum runtime limit treated as **24,576**. CI `pnpm size:guard` fails if Factory runtime exceeds 24,576 − 1,024.

Split (no proxies): `InstantLaunchModule` holds `new ReactorToken`, EIP-712 `LaunchAuthorization.verify`, and official-pool open. Factory still `claimOnLaunch`s, opens InstantCurve, pulls Dev Buy, and owns fair bid/claim storage.

## Arc Public Testnet deploy attempt

Script: `pnpm arc:factory-attempt` → `deployments/arc-factory-attempt.json`.

- RPC: `https://rpc.testnet.arc.io` (chain **5042002** expected).
- Exact Factory creation bytecode + dummy constructor args.
- `eth_estimateGas` recorded (success or error).
- `eth_sendRawTransaction` **not** sent (no `ARC_TESTNET_PK`).
- **`claimed: false`**. Do not treat this as a live Factory on Arc.
- Mainnet 5042 blocked.

## P0 landings

**A. Launch admission.** Public `POST /launch/authorize` → durable admission (Postgres/SQLite) → ALLOW receipt → isolated signer. CHALLENGE ≠ ALLOW. Direct signer without receipt fails. Real Turnstile when `TURNSTILE_SECRET` is set. LOCAL bypass only if secret unset and `TURNSTILE_REQUIRED !== 1`.

**B. EIP-712 identity.** Signed: factory, Factory version, creator, quote, decimals, mode, ticker, name, metadata hash, virtualQuote0, curve, authId, deadline, chain. Metadata frozen at launch (`metaFrozen`). `permanentlyLockTicker` requires a REACTOR-native authorized-factory token with matching ticker; `reserveTicker` is separate; both irreversible.

**C. Factory EIP-170.** Measured, split, CI guard, Arc probe. See table.

**D. Quotes.** Simulate exact RouteGraph edges (`OFFICIAL_REACTOR_V4` / `EXTERNAL_V4_HOOKLESS` / `BONDING_CURVE`). Nested fees per REACTOR leg. ≤3 hops. Sim fail → unavailable. Never `minOut` 0/1.

**E. Indexer.** Rich `OfficialPoolCreated` UPSERT, transactional idempotence, 24h aggregations, SQL pagination/search, `ARC_FINALITY_CONFIRMATIONS` (default 8).

**F. Keeper.** Single lease leadership (not mixed with advisory). Canonical `ValuationService`. No silent static ZEC in prod (`ZEC_HTTP_URL` required). R2/S3 fail-closed in prod. Safe genesis Batch A → verify → Batch B T0. `CoreToken` naming. SSE.

## Docs / UI

Deep `/docs` corpus (Trader / Creator / Builder / Protocol / Reference), How REACTOR Works, trust top-10, Guardian/Keeper, admission, routes, examples, `llms.txt`, version badges, `docs:check`. UI: home search, `/search`, launch ticker + challenge, Lightweight Charts, tape, contextual docs, Ops token gate in prod.

## Tests

| Suite | Result |
| --- | --- |
| `pnpm size:guard` | green (Factory 23280 ≤ 23552) |
| `pnpm docs:check` | required green this pass |
| Indexer unit (admission, launch-auth, persist) | required green |
| Foundry | **321 pass** after identity-helper fix (was 318 + 3 WrongName/Mode/Metadata) |
| Playwright / visual 1440/390 | after preview |

## Honest gaps

- Not audited. No public mainnet addresses.
- Arc Factory **not claimed** — estimate/RPC only unless an explorer hash exists in `deployments/arc-factory-attempt.json`.
- Top-10 ranks remain an offchain API (trust assumption #1).
- LOCAL Turnstile bypass when secret unset.
- LOCAL inline signer (`SIGNER_INLINE`) unless set to `0`. Isolated signer process still exists for prod-shaped runs.
- Funding-cluster signals are practical heuristics, not a full chain-analysis product.
- `setMetadata` removed — identity is frozen at launch; no post-launch creator edit path.

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
