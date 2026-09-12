# BUILD REPORT — Protocol 0.3.0 correctness

**Status:** Continue on existing REACTOR Origin repo. Parent `879c2b8` (protocol 0.2.0, Factory V1). Local Anvil 5042002 + Arc Public Testnet probe only.  
**Not audited. Not mainnet. Arc Public Testnet Factory create not claimed unless an explorer hash exists.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.0** (`docs/version.json`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | Admission integrity, UserRouteQuoter, indexer 24h/USD/keyset, ValuationService, SigV4, Arc BFT finality, docs + UI |
| Mainnet | **Blocked** |

## EIP-170 sizes

Measured with `forge build --sizes` + `pnpm size:guard` (limit 24,576 − 1,024 = **23,552**).

| Contract | Runtime (bytes) | Creation | Gate |
| --- | ---: | ---: | --- |
| ReactorFactory | **23,286** | 25,415 | ≤ 23,552 **pass** (was 23,280 at 0.2.0; +6 from `registerNative` no longer try/catch) |
| InstantLaunchModule | 17,092 | 17,682 | under EIP-170 |
| InstantCurve | 18,960 | 19,644 | under |
| ReactorHook | 10,952 | 11,813 | under |
| TickerRegistry | 4,827 | 5,722 | under |
| UserRouteQuoter | 8,559 | 8,899 | new module — not Factory |

Factory **stays V1**. New logic is in InstantLaunchModule, TickerRegistry, UserRouteQuoter, libraries, and the backend.

## P0 landings (0.3.0)

**Admission.** Real Turnstile widget + `siteverify`. ELEVATED/ATTACK solved challenge → ALLOW under limits (table-driven). Signed-auth token-bucket (SQL atomic, optional Redis). `launchConfigHash` on ALLOW; signer match required. Atomic receipt consume + concurrent test. Honest funding-cluster (network /16+ASN, optional first USDC funder). No KYC.

**Fair / ticker.** Fair `curveConfig` hashes supply/decimals/duration/auctionBps/minRaise. Instant stays `INSTANT_CURVE_V1`. `permanentlyLockTicker` reverts if another token holds the 24h lock.

**Quotes.** `UserRouteQuoter` one eth_call whole-route preview. Edge kinds through plan/sim/response. Multi-candidate by real `amountOut`. Nested fee legs. Separate fee-exempt maintenance path. Never minOut 0/1 on a successful ticket.

**Indexer / Keeper.** Atomic lease (`UPDATE…RETURNING` / txn). Store transactions. Only 23505/UNIQUE as duplicate. 24h NUMERIC, latest-by-ts, ValuationService USD, 24h USD volume, incremental + expire. Candles `limit/before/after`. Bounded tape. Keyset pagination. NUMERIC sorts.

**Valuation / media / Safe / Arc.** One ValuationService. `external_price_marks` worker. No static ZEC in PROD. Signer uses ValuationService. Sharp explicit. Stream 2MB. SigV4 PUT. Safe Transaction Builder JSON. `registerNative` not silent. Arc USDC 18/6. Finality default 0. Broadcast if `ARC_TESTNET_PK`, else honest blocker.

## Honest gaps

- Not audited. No public mainnet addresses.
- Arc Factory **not claimed** without an explorer hash in `deployments/arc-factory-attempt.json`. This environment has **no `ARC_TESTNET_PK`** — `pnpm arc:factory-attempt` records RPC liveness + sizes only.
- Top-10 ranks remain an offchain API.
- LOCAL Turnstile bypass when secret unset.
- LOCAL inline signer unless `SIGNER_INLINE=0`.
- Funding-cluster is a heuristic (ASN + /16 + optional first-USDC-funder), not chain analysis.
- `UserRouteQuoter` preview needs token balances (eth_call / state override) — same as any swap sim. Probe hops still use minOut=1 **inside** the revert-preview, not as a user ticket floor.
- If `UserRouteQuoter` is not deployed, indexer falls back to one `UserRouteExecutor` `simulateContract` per candidate (still one call; hop kinds then default).
- Safe Builder JSON is a template until genesis env addresses are filled.
- `sharp` native install may need `pnpm approve-builds` on a fresh host.
- Factory runtime **23,286** is 6 bytes above the 0.2.0 figure of 23,280. Still under the 23,552 CI gate.

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
