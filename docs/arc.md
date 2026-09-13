# Arc

> REACTOR targets **Arc Public Testnet** (chain `5042002`). Arc Mainnet (`5042`) is blocked.

This repo does **not** claim a public testnet Factory without an explorer hash. Local demo uses Anvil with the same chain id. See [Local demo](/docs/local) and [Deployments](/docs/deployments).

## Native currency

| Unit | Decimals | Role |
| --- | --- | --- |
| Native gas | **18** | USDC used as gas internally |
| USDC ERC-20 | **6** | `0x3600000000000000000000000000000000000000` — protocol quote, `usdPegOne` |

Do not treat gas-18 USDC as the ERC-20. Quote accounting is 6 decimals. Mixing `address.balance` with `USDC.balanceOf` by 1e12 is a client bug. Contracts use the ERC-20 interface only.

Arc value-transfer rules: native send to `address(0)` reverts; a blocklisted index-1 test address reverts. Vaults never burn native USDC to zero.

## Finality

Arc docs ([deterministic finality](https://docs.arc.io/arc/concepts/deterministic-finality)): Malachite BFT, final on commit, **no confirmation window, no reorgs**.

Indexer default `ARC_FINALITY_CONFIRMATIONS=0`. The Ethereum-style 8-block lag is dropped. Override only if you are not on Arc.

`INDEXER_START_BLOCK` (decimal) is an optional catch-up window used when the sqlite cursor is empty. `INDEXER_MAX_BLOCK_SPAN` caps each tick (default 2000). `INDEXER_LEAN_LOGS=1` watches Factory / InstantCurve / TickerRegistry only and splits `eth_getLogs` per address — public Arc RPCs reject the full topic+address OR. None of these change finality.

## Deploy

`pnpm arc:factory-attempt`:

- Always records RPC liveness, chain id, Factory creation/runtime sizes.
- Broadcasts **only** if `ARC_TESTNET_PK` is set, chain is 5042002, and runtime ≤ 24,576.
- `claimed` stays **false** until an explorer hash is confirmed on [testnet.arcscan.app](https://testnet.arcscan.app).
- Without a key, the JSON lists an honest blocker checklist (Circle faucet → key → re-run → explorer). Same content: `deployments/arc-testnet-blocker.md` and `scripts/arc-testnet-checklist.md`. **claimed stays false.**

Circle / Uniswap have **not** published a canonical Arc Public Testnet `PoolManager`. The #16 rehearsal deployed official v4-core (BUSL, non-production) via `Deploy.s.sol` — labeled in `docs/deployments.md`. Local Anvil 5042002 ships the same official v4-core.

## Multicall3

Canonical Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) is **not assumed** on Arc. `readContractsBatched` probes bytecode, requires one successful `multicall`, and otherwise runs independent `readContract` calls in parallel. Anvil usually has the contract; Arc testnet may not. See [Read path performance](/docs/perf).

Chainlink CRE lists a separate **Arc Testnet** (EIP-155 **1883**) for TypeScript workflows. This repo’s 5042002 demo and 5042 mainnet are not that catalog entry. CRE production writes to Arc Mainnet **5042 are not available and not claimed**. See `ops/cre/README.md` and [Automation](/docs/automation).

## Issue #16 rehearsal (SUPERSEDED dump + isolated constructors live)

`pnpm arc:rehearsal` probes live RPCs (`rpc.testnet.arc.io`, `rpc.testnet.arc.network`, plus Arc-doc alternates), verifies `eth_chainId = 5042002`, attempts the Circle faucet, and writes `deployments/arc-testnet-rehearsal.json` + `.md`.

The 2026-09-12 `forge script script/Deploy.s.sol:Deploy` dump in `deployments/arc-testnet.json` is **SUPERSEDED / non-PROD-isolated**. Factory `0xB48D1B397834eBcccb8961041d827487097e0535` create tx is [on explorer](https://testnet.arcscan.app/tx/0xa7297d2104b926b9372d93d16598fd5e8c4171955b0e5d3b6ce6ce0468752c67). Instant + Fair smoke: `pnpm arc:smoke` → `deployments/arc-testnet-smoke.json`. Instant/Fair quote on that dump is **Mock USDC-6**, not canonical `0x3600…0000`. `guardian()` / `launchSigner()` / `pricingSigner()` / `keeper()` all = lost disposable `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E`. Immutable guardian — cannot rotate. Davis chose REDEPLOY.

Isolated PROD-path constructors are **live** (`SAFE_GENESIS=true`, deployer `0x3E00CE2Dc40FaFB0D2dA4A5e6004278Fdf65AAF5` ≠ guardian). ReactorGuardian `0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934` (`guardian()` = Davis EOA `0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406`). Factory `0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA`. First create [0x7955fda2…](https://testnet.arcscan.app/tx/0x7955fda2d6a590d83e188daa509a7112ddb70bc126e325a5bd644761d0921e27). `launchesPaused=true`. On-chain launchSigner/pricingSigner still = keeper until Davis HW-signs `SafeGenesisBatch.s.sol`. `pauseLaunches(false)` LAST after VerifyGenesis. Dump: `deployments/arc-testnet-isolated.json`. No Instant/Fair smoke hashes. Runbook: `scripts/arc-testnet-eoa-genesis-runbook.md`.

`pnpm arc:wallet-harness` ran the LOCAL authorize Instant RHRSL + Fair RHRFL path against the **old** dump (same ABIs as the Next app: `POST /launch/authorize` → `launchStandard` / `createFairLaunch` → `POST /quote` → `UserRouteExecutor`). Evidence: `deployments/arc-testnet-journey.json` (`claimedArcTestnet: true` for that historical explorer path; `superseded: true`; `blockers` lists LOCAL/non-PROD gaps plus the lost-key redeploy). Direct Factory smoke does **not** replace that path. LOCAL is not full PROD.

`pnpm arc:prod-web` writes `deployments/arc-testnet.env.example` and `deployments/arc-testnet-prod-path.json`. Public `NEXT_PUBLIC_WALLETCONNECT_ID` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are wired in that example. `claimedProdPath` stays **false** until Instant/Fair smoke on the **new** deploy + Turnstile + wallet UI ACs land. Never commit `TURNSTILE_SECRET`, HMAC, signer PKs, or Sentry DSN.

Circle faucet automation still receives GraphQL `RECAPTCHA_ERROR`. The superseded rehearsal was funded from a box throwaway wallet. Keep [#16](https://github.com/solarcurvey/reactor/issues/16) open until human AC is met.

## Mainnet blockers (honest)

1. Uniswap v4-core BUSL-1.1 — no production deploy without Additional Use Grant or Change Date (2027-06-15).
2. No official PoolManager on Arc Testnet as of 2026-09-11; none on Mainnet (5042).
3. No audit, no bug bounty, no formal verification.
4. Circle / Arc native USDC dual-decimal and blocklist semantics are not fully reproduced on Anvil.
5. InstantLaunchStrategy / CCA launcher stack is not REACTOR-compatible.

Do not add a 5042 address to `deployments/registry.json`. `pnpm docs:check` fails if the generated mainnet section contains a contract address.

See [Deployments](/docs/deployments), [Trust](/docs/trust).
