# BUILD REPORT — Protocol 0.3.1 leftovers

**Status:** Continue on existing REACTOR Origin repo. Parent `72bc0a6` (protocol 0.3.0, Factory V1). Local Anvil 5042002 + Arc Public Testnet probe only.  
**Not audited. Not mainnet. Arc Public Testnet Factory create not claimed unless an explorer hash exists.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.1** (`docs/version.json`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | Close honest leftovers: Safe Builder JSON, quoter state overrides, production hard gates, funding-parent, sharp, Arc blocker, CoreToken/USDC-18 leftovers |
| Foundry | Recorded after `forge test` this run |
| Indexer / lib | `pnpm --filter indexer test` + web top10/marketdata + `pnpm docs:check` |
| Review shots | Regenerated `review/*-{1440,390}.png` this commit including bonding token (`BONDING_TOKEN` + seed) |
| Mainnet | **Blocked** |

## Closed this run

| Leftover | Closed? | Evidence |
| --- | --- | --- |
| Safe Builder JSON / MultiSend from artifacts | **Yes** | `pnpm safe:genesis` → `deployments/safe-genesis-batch-{a,b}.json` + index. Deployer ≠ Safe. `scripts/safe-genesis-builder.test.ts` |
| UserRouteQuoter intermediate-balance failure | **Yes** | Indexer `eth_call` + state overrides (`quote-overrides.ts`). Foundry `test_nested_preview_without_intermediate_wallet_balances`. Fallback documented only if quoter undeployed |
| Production hard gates | **Yes** | `prod-gates.ts`: Turnstile secret/site key + no inline/Anvil signer outside LOCAL. Start + authorize refuse. Tests |
| Funding-parent honesty | **Yes** | Rename + bounded USDC funder lookback + tests. Not chain analysis |
| sharp required | **Yes** | `pnpm.onlyBuiltDependencies`, `assertSharpWorks()`, `docs/media.md` (`pnpm approve-builds`) |
| Screenshots 1440 + 390 including bonding | **Yes** | `review/token-bonding-*.png` this commit |
| Arc Public Testnet Factory | **No — documented** | No `ARC_TESTNET_PK`. `deployments/arc-testnet-blocker.md` + `scripts/arc-testnet-checklist.md`. `claimed: false` |
| registerNative / CoreToken / ETH-native leftovers | **Yes** | Indexer/keeper/signer/e2e native gas USDC-18. `CoreToken` name; `TestCORE` alias. Registry lists UserRouteQuoter + InstantLaunchModule |
| Docs / version | **Yes** | 0.3.1 patch. `pnpm docs:check` |

## Still blocked (do not fake)

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Independent Codex / professional audit | Not performed. Do not claim audited. |
| Top-10 as onchain oracle | Frozen offchain by design. |
| Arc Factory claimed | No funded `ARC_TESTNET_PK` in this environment. |

## EIP-170 sizes

Measured with `forge build --sizes` + `pnpm size:guard` (limit 24,576 − 1,024 = **23,552**). Factory **stays V1**. Quoter / gates / Safe JSON are off-Factory.

| Contract | Runtime (bytes) | Gate |
| --- | ---: | --- |
| ReactorFactory | (see `deployments/sizes.json`) | ≤ 23,552 |
| InstantLaunchModule / InstantCurve / ReactorHook / TickerRegistry / UserRouteQuoter | under EIP-170 | n/a |

## Honest gaps that remain (not leftovers we pretended to close)

- LOCAL Turnstile bypass when secret unset (explicit LOCAL only).
- LOCAL inline signer unless `SIGNER_INLINE=0`.
- Funding-parent is a heuristic (ASN + /16 + optional first-USDC-funder).
- If `UserRouteQuoter` is not deployed, executor fallback may still need wallet balances.
- Factory runtime must stay under the CI margin.

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
