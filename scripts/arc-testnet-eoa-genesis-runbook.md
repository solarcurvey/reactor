# Arc Public Testnet — EOA-guardian SAFE_GENESIS redeploy (#16)

Docs + ops runbook only. **Do not claim on-chain success from this PR.** Constructors are broadcast on the ops box. Davis Ramsey hardware-signs remaining genesis. **#16 stays open.** No Arc Mainnet (`5042`). Factory **V1** economics are frozen.

## Why the 2026-09-12 dump is blocked

The live 5042002 stack from the #16 rehearsal is **SUPERSEDED / non-PROD-isolated**:

| Role / contract | Address | Problem |
| --- | --- | --- |
| ReactorGuardian | `0x2CdF37541256749E5CF6ac5C806e0d23A685F224` | Immutable `guardian()` |
| Factory V1 | `0xB48D1B397834eBcccb8961041d827487097e0535` | Bound to that Guardian |
| `guardian()` / `launchSigner()` / `pricingSigner()` / `keeper()` | `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E` | Lost disposable key |

`ReactorGuardian.guardian` is constructor-immutable. There is no rotate. Davis chose **REDEPLOY**, not key recovery. Keep the explorer hashes in `deployments/arc-testnet.json` as historical evidence. Do not point isolated PROD at `0x2CdF…` / `0xB48D…`.

## Target roles (this round — no Gnosis Safe)

| Env | Address | Notes |
| --- | --- | --- |
| `GUARDIAN` / `EXPECTED_SAFE` | `0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406` | Davis hardware EOA. Immutable constructor guardian. **Not** a Gnosis Safe this round. |
| `EXPECTED_LAUNCH_SIGNER` | `0xd880BD31948Ffc89E8D26C6ac90f98F825E56E9e` | Isolated launch signer |
| `EXPECTED_PRICING_SIGNER` | `0x346363d14E6Acf1b05CA8Aa22F7E06a201A69a76` | Isolated pricing signer |
| `EXPECTED_KEEPER` / `KEEPER` | `0xf2105235d0a74969f229deb72d3C8C578643147F` | Spare / gateway path |
| Deployer EOA | funded ops-box EOA, **≠** guardian | `SAFE_GENESIS=true` requires `guardian != deployer` |

Public web env (committed examples only):

```bash
NEXT_PUBLIC_WALLETCONNECT_ID=f7366a56987b5b93b9dd8099f8e5b419
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAEyd86VMZKBjIeLX
```

Never commit private keys, HMAC secrets, `TURNSTILE_SECRET`, `SIGNER_INTERNAL_TOKEN`, `ADMISSION_HMAC_SECRET`, `PRICING_SIGNER_PK`, or Sentry DSN.

New **ReactorGuardian** / **ReactorFactory** addresses stay empty in `deployments/arc-testnet-isolated.json` until the ops box broadcasts. Do not invent them. Do not invent tx hashes.

## 1. Constructors on the ops box (`SAFE_GENESIS=true`)

Founder broadcasts `script/Deploy.s.sol:Deploy` from the funded deployer EOA. This is **off-PR**.

```bash
export PATH="$PATH:$HOME/.foundry/bin"
export ARC_TESTNET_RPC=https://rpc.testnet.arc.network
cast chain-id --rpc-url "$ARC_TESTNET_RPC"   # must be 5042002 — never 5042

export SAFE_GENESIS=true
export GUARDIAN=0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406
export KEEPER=0xf2105235d0a74969f229deb72d3C8C578643147F
# DEPLOYER_PK = funded ops-box EOA. Never commit. Must be ≠ GUARDIAN.

cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_TESTNET_RPC" \
  --broadcast --legacy \
  --private-key "$DEPLOYER_PK"
```

`SAFE_GENESIS=true` deploys constructors only (`Deploy.s.sol`). Launches stay paused. The deployer must not call Guardian ops. After broadcast, copy real addresses + explorer create hashes into `deployments/arc-testnet-isolated.json` (`addresses.Guardian`, `addresses.ReactorFactory`, `pendingAddresses`, `verificationUrl`). Then `pnpm docs:gen`. **claimed: true** only after [testnet.arcscan.app](https://testnet.arcscan.app) shows those receipts. `claimedProdPath` stays **false**.

## 2. Genesis calldata (Davis HW-signs as EOA `EXPECTED_SAFE`)

`EXPECTED_SAFE` is Davis's EOA, not a Gnosis Safe. `SafeGenesisBatch.s.sol` still emits the **order + calldata**. Davis signs each call from the hardware wallet (the immutable guardian). `pnpm safe:genesis` JSON is optional ordering reference — do not require the Safe Transaction Builder UI this round.

```bash
export EXPECTED_SAFE=0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406
export DEPLOYER=<ops-box deployer EOA that broadcast constructors>
export EXPECTED_LAUNCH_SIGNER=0xd880BD31948Ffc89E8D26C6ac90f98F825E56E9e
export EXPECTED_PRICING_SIGNER=0x346363d14E6Acf1b05CA8Aa22F7E06a201A69a76
export EXPECTED_KEEPER=0xf2105235d0a74969f229deb72d3C8C578643147F
export GUARDIAN_CONTRACT=<NEW ReactorGuardian — fill after broadcast>
# plus REGISTRY, FACTORY, USDC, HOOK, … from the new dump

# View-only: prints Batch A / VERIFY / Batch B calldata. Does not broadcast.
cd contracts
forge script script/SafeGenesisBatch.s.sol:SafeGenesisBatch --rpc-url "$ARC_TESTNET_RPC"
```

Checks baked into the script (fail closed):

- `auth.guardian() == EXPECTED_SAFE`
- `EXPECTED_SAFE != DEPLOYER`
- launch signer ≠ keeper ≠ guardian ≠ deployer
- pricing signer ≠ keeper ≠ guardian ≠ deployer
- `launchesPaused()` still true

### Batch A — config while paused (do not unpause)

Davis HW-sends the Batch A calls **in script order** (`setPricingSigner`, `setLaunchSigner`, `bindTickerRegistry`, `authorizeFactory`, quote registry, binds, seal, …). Deployer cannot call these.

### VerifyGenesis — still paused

```bash
forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url "$ARC_TESTNET_RPC"
```

Must print `GENESIS_OK`. Requires `launchesPaused() == true`. Do not continue if it reverts.

### Batch B — `pauseLaunches(false)` LAST

1. `CoreVesting.activateLaunch()`
2. **`pauseLaunches(false)` last** — only after VerifyGenesis

Unpausing before verify is a failed genesis. `claimedProdPath` is still false after unpause.

## 3. After genesis (still not #16 done)

1. Record explorer hashes in `deployments/arc-testnet-isolated.json` + `deployments/registry.json`.
2. `pnpm docs:gen` && `pnpm docs:check`.
3. Instant + Fair smoke against the **new** Factory (not `0xB48D…`).
4. Production Next + indexer: Turnstile **secret** (host-only) + isolated signer PKs (host-only) + wallet UI ACs.
5. Flip `claimedProdPath` only after those ACs. Keep [#16](https://github.com/solarcurvey/reactor/issues/16) open until then.

See `scripts/arc-testnet-runbook.md`, `scripts/arc-testnet-checklist.md`, `docs/guardian.md`, `TESTNET_DEPLOYMENT.md`.
