# EOA genesis (no Gnosis Safe)

> Protocol **{{protocolVersion}}**. Factory **{{factoryVersionLabel}}**. Not audited. No Arc Mainnet (5042).

Arc may not have Gnosis Safe for a while. An immutable **EOA Guardian** can finish Batch-A wiring in **one transaction** after `SAFE_GENESIS` constructors, without widening who can administer the system.

Safe MultiSend (`SafeGenesisBatch.s.sol`, `pnpm safe:genesis`) remains the path on chains that have Safe. This page is the EOA alternative. See [Guardian](/docs/guardian) and `GUARDIAN_MODEL.md`.

## Trust (do not widen)

| Rule | How it is enforced |
| --- | --- |
| Only the immutable guardian EOA/Safe can start | `completeGenesis` / `finalizeGenesis` use `onlyGuardian` (`msg.sender == guardian`) |
| Auth contract is not a forever admin | `isGuardian(address(auth))` is true **only** while the transient genesis proxy is on (inside those two calls) |
| After success, peripherals accept the EOA/Safe again | `genesisSealed` + proxy off. Post-seal `bindFactory` from `address(auth)` reverts `NotGuardian` |
| Launches stay paused until ready | Constructor starts paused. `completeGenesis(..., false)` stays paused. Unpause is last |
| One-shot | Second `completeGenesis` reverts `GenesisAlreadySealed` |
| Fail closed if already open | `completeGenesis` reverts `LaunchesMustStayPaused` if launches are already open |
| Factory V1 economics unchanged | No fee/split/supply knobs. `FACTORY_VERSION` stays **1** |

`TickerRegistry` already accepted `address(auth)` permanently so Guardian-proxied ticker admin (`authorizeFactory`, locks) keeps working. That is not a generic execute. Other peripherals use `auth.isGuardian(msg.sender)`.

Tests: `contracts/test/unit/CompleteGenesis.t.sol` — happy path, non-guardian, double-call, post-seal EOA-only binds, Safe-style individual binds without `completeGenesis`.

## When to use which path

| Situation | Path |
| --- | --- |
| Chain has a production Safe; Safe **is** `guardian()` | `SAFE_GENESIS=true` constructors → Safe MultiSend Batch A → `VerifyGenesis` → Batch B. Do **not** need `completeGenesis` |
| No Safe (Arc today); Guardian is a hardware EOA | Constructors → `completeGenesis` → optional verify gap → `finalizeGenesis` (or one-shot unpause) |
| Local demo (`GUARDIAN == deployer`) | Existing `Deploy.s.sol` binds in-process. Not production-shaped |

Never deploy with a temporary Guardian and “transfer later.” `guardian` is immutable.

## Runbook (Arc Public Testnet / any no-Safe chain)

Do **not** deploy to chain **5042**. Do not claim Instant/Fair smoke from constructors alone.

### 1. Constructors (`SAFE_GENESIS=true`)

Deployer ≠ Guardian. Launches stay paused. No Guardian binds in this broadcast.

```bash
export SAFE_GENESIS=true
export GUARDIAN=0x…   # immutable EOA (hardware)
export KEEPER=0x…     # designated Keeper; ≠ Guardian; ≠ launch/pricing signers
# forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast --legacy
```

Record addresses. On-chain: `guardian() == GUARDIAN`, `launchesPaused() == true`.

### 2. Batch A — one Guardian tx

The Guardian EOA calls `ReactorGuardian.completeGenesis(wiring, unpauseAfterVerify)`.

`wiring` is `GenesisTypes.Wiring`: pricing/launch signers (≠ Keeper ≠ Guardian ≠ deployer), ticker registry, factory, quote registry, USDC, hook, CORE LP vault, adapters, buyback, flywheel, launch module, LP vault, curve, SelfBurn, CORE buyback executor, router, user router, vesting, CORE.

`unpauseAfterVerify`:

- **`false` (recommended):** wire + onchain checks equivalent to `VerifyGenesis` / `GenesisComplete.verify`, **seal the proxy**, leave `launchesPaused`. Then run `script/VerifyGenesis.s.sol` (set `EXPECTED_SAFE` to the Guardian EOA). Then Batch B.
- **`true`:** same checks, then `activateLaunch` + `pauseLaunches(false)` in the **same** transaction. Use only if you accept no offchain verify gap.

Encode:

```bash
# logs completeGenesis calldata (Guardian EOA submits)
forge script script/EoaGenesis.s.sol:EoaGenesis --rpc-url $RPC
```

Env keys match `SafeGenesisBatch` (`GUARDIAN_CONTRACT`, `REGISTRY`, `USDC`, `HOOK`, … plus `EXPECTED_PRICING_SIGNER`, `EXPECTED_LAUNCH_SIGNER`, `EXPECTED_KEEPER`, `DEPLOYER`). `UNPAUSE_AFTER_VERIFY` default `false`.

### 3. Verify (when `unpauseAfterVerify == false`)

```bash
export EXPECTED_SAFE=$GUARDIAN   # EOA is the immutable guardian
forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url $RPC
```

Must still show launches paused, protocol vaults sealed, usdPegOne USDC, no deployer/Guardian/Keeper CORE, isolated signers.

### 4. Batch B — one Guardian tx

```text
ReactorGuardian.finalizeGenesis(vesting)
```

Sets vesting T0 and `pauseLaunches(false)` last. One-shot (`genesisFinalized`). The Guardian EOA may instead call `CoreVesting.activateLaunch()` then `pauseLaunches(false)` directly — both still require `msg.sender == guardian`.

## What this is not

- Not a Gnosis Safe substitute for **#18** final-production Guardian (Safe when the chain has it).
- Not a redeploy of an already-constructed Guardian (immutable). Existing paused constructors need this bytecode on a **new** deploy.
- Not Factory V2. Not a fee change. Not mainnet.
- Not Instant/Fair smoke. Keep [#16](https://github.com/solarcurvey/reactor/issues/16) open until live journeys exist.

## Related

[Guardian](/docs/guardian) · [Deployments](/docs/deployments) · [Security](/docs/security) · [Arc](/docs/arc) · issue **#85**
