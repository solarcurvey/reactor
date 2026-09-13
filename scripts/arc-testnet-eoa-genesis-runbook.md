# Arc Public Testnet — EOA-guardian SAFE_GENESIS redeploy (#16)

Docs + ops runbook. **Constructors are live** on 5042002. HW genesis is **not** done. Instant/Fair smoke is **not** recorded. `claimedProdPath` stays **false**. **#16 stays open.** No Arc Mainnet (`5042`). Factory **V1** economics are frozen.

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
| Deployer EOA | `0x3E00CE2Dc40FaFB0D2dA4A5e6004278Fdf65AAF5` | Ops-box constructor EOA. **≠** guardian. |

Public web env (committed examples only):

```bash
NEXT_PUBLIC_WALLETCONNECT_ID=f7366a56987b5b93b9dd8099f8e5b419
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAEyd86VMZKBjIeLX
```

Never commit private keys, HMAC secrets, `TURNSTILE_SECRET`, `SIGNER_INTERNAL_TOKEN`, `ADMISSION_HMAC_SECRET`, `PRICING_SIGNER_PK`, or Sentry DSN.

## Constructors live (2026-09-13)

`SAFE_GENESIS=true` constructors are on [testnet.arcscan.app](https://testnet.arcscan.app). Dump: `deployments/arc-testnet-isolated.json`. `claimedArcTestnet=false`. `claimedProdPath=false`. No Instant/Fair smoke hashes.

| Contract | Address | Explorer |
| --- | --- | --- |
| ReactorGuardian | `0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934` | [addr](https://testnet.arcscan.app/address/0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934) |
| Factory V1 | `0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA` | [addr](https://testnet.arcscan.app/address/0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA) |
| PoolManager | `0x96c8Aa3A873d34B944cA36AB24a60365D63eaB95` | [addr](https://testnet.arcscan.app/address/0x96c8Aa3A873d34B944cA36AB24a60365D63eaB95) |
| QuoteAssetRegistry | `0x2c535Ac2a06528813812aA4a015B48ED67eC0d77` | |
| TickerRegistry | `0xF67bAeEf71e3Dad0379c70bC148545855c5FD15c` | |
| CoreToken | `0x33a43C5cf5579cb2446B8FEb6fcDb3Fa2987b517` | |
| USDC mock | `0x50bff653519e0dF72BCd951f27DC0e869De77AdB` | |
| Vault | `0x1776adBFf5bFd7d40B7812B9ecfd0eD1036952f6` | |
| Router | `0x5A9b43E63Ba71Bff1DBCF9B4feF2A186dd1B33E6` | |
| Hook | `0x847beaE21F679A3b08C7a1b82AE5F00753b170cc` | |
| Buyback | `0x901f29c1f6994b5d9508a23Ac64888159f7c1c74` | |
| Flywheel | `0xdE027Ac45292Ee9cfacfc00274532b11A624776D` | |
| InstantLaunchModule | `0x1fe85a9753DD443AaC9E2CfCCB9Ae5946F0036C9` | |
| InstantCurve | `0x8555fbB90a9017221b05bE24487023fD8dCB18AA` | |
| SelfBurnVault | `0x9b9bd7Fa5764D5cCB9Dab4509F40FE20Fef6Dc1E` | |
| V4Adapter | `0x3BEbB45e4675E76C248d04F55a1c0DE2706E3586` | |
| ProtocolV4Adapter | `0x052A5f61169F3123e6951dDb44063b6F0449c9B3` | |
| UserRouteExecutor | `0xcBD5E00127470EdBE7492C9BdDbb65a850e8290A` | |
| UserRouteQuoter | `0x0857F2b67f3B23AB11F48C6E43e1fc4973A7d17f` | |
| CoreVesting | `0x13d40169bB2F0287BE5319953A759492E7063828` | |
| CoreLiquidityVault | `0x7c8D7b8ccCb131237b3eaCBCDc76d5742720AC15` | |
| CoreBuybackExecutor | `0xF3B592e5aAE487d62f606CFA8A4BB45C9Fdc0936` | |
| FairVault | `0xc131B6e8fDE3E26f55a4bEA6B150C40575C28df6` | |
| RoutingRegistry | `0x6C527365202BFd5729578D2eFf7BA9B732321B40` | |

On-chain (constructors only): `guardian()` = Davis EOA, `launchesPaused=true`, `launchSigner()`/`pricingSigner()` still = keeper. First create [`0x7955fda2…`](https://testnet.arcscan.app/tx/0x7955fda2d6a590d83e188daa509a7112ddb70bc126e325a5bd644761d0921e27). Last create [`0x05164100…`](https://testnet.arcscan.app/tx/0x051641005b9193f512cbf30d600f1e24b6ab038daac6b19015e8cd7b5de71ee5).

Replay (already broadcast — do not re-run unless redeploying again):

```bash
export PATH="$PATH:$HOME/.foundry/bin"
export ARC_TESTNET_RPC=https://rpc.testnet.arc.network
cast chain-id --rpc-url "$ARC_TESTNET_RPC"   # must be 5042002 — never 5042

export SAFE_GENESIS=true
export GUARDIAN=0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406
export KEEPER=0xf2105235d0a74969f229deb72d3C8C578643147F
# DEPLOYER_PK was ops-box 0x3E00CE2Dc40FaFB0D2dA4A5e6004278Fdf65AAF5. Never commit.
```

## 2. Genesis calldata (Davis HW-signs as EOA `EXPECTED_SAFE`)

`EXPECTED_SAFE` is Davis's EOA, not a Gnosis Safe. `SafeGenesisBatch.s.sol` still emits the **order + calldata**. Davis signs each call from the hardware wallet (the immutable guardian). `pnpm safe:genesis` JSON is optional ordering reference — do not require the Safe Transaction Builder UI this round.

```bash
export EXPECTED_SAFE=0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406
export DEPLOYER=0x3E00CE2Dc40FaFB0D2dA4A5e6004278Fdf65AAF5
export EXPECTED_LAUNCH_SIGNER=0xd880BD31948Ffc89E8D26C6ac90f98F825E56E9e
export EXPECTED_PRICING_SIGNER=0x346363d14E6Acf1b05CA8Aa22F7E06a201A69a76
export EXPECTED_KEEPER=0xf2105235d0a74969f229deb72d3C8C578643147F
export GUARDIAN_CONTRACT=0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934
export FACTORY=0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA
export REGISTRY=0x2c535Ac2a06528813812aA4a015B48ED67eC0d77
export USDC=0x50bff653519e0dF72BCd951f27DC0e869De77AdB
export TICKER_REGISTRY=0xF67bAeEf71e3Dad0379c70bC148545855c5FD15c
export HOOK=0x847beaE21F679A3b08C7a1b82AE5F00753b170cc
export VAULT=0x1776adBFf5bFd7d40B7812B9ecfd0eD1036952f6
export FLYWHEEL=0xdE027Ac45292Ee9cfacfc00274532b11A624776D
export BUYBACK=0x901f29c1f6994b5d9508a23Ac64888159f7c1c74
export CURVE=0x8555fbB90a9017221b05bE24487023fD8dCB18AA
export SELF_BURN=0x9b9bd7Fa5764D5cCB9Dab4509F40FE20Fef6Dc1E
export USER_ROUTER=0xcBD5E00127470EdBE7492C9BdDbb65a850e8290A
export USER_ADAPTER=0x3BEbB45e4675E76C248d04F55a1c0DE2706E3586
export PROTOCOL_ADAPTER=0x052A5f61169F3123e6951dDb44063b6F0449c9B3
export CORE_LP=0x7c8D7b8ccCb131237b3eaCBCDc76d5742720AC15
export CORE_BUYBACK=0xF3B592e5aAE487d62f606CFA8A4BB45C9Fdc0936
export ROUTER=0x5A9b43E63Ba71Bff1DBCF9B4feF2A186dd1B33E6
export VESTING=0x13d40169bB2F0287BE5319953A759492E7063828
export LAUNCH_MODULE=0x1fe85a9753DD443AaC9E2CfCCB9Ae5946F0036C9
export CORE=0x33a43C5cf5579cb2446B8FEb6fcDb3Fa2987b517

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

1. Record genesis explorer hashes in `deployments/arc-testnet-isolated.json` (do not invent Instant/Fair smoke).
2. `pnpm docs:gen` && `pnpm docs:check`.
3. Instant + Fair smoke against Factory `0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA` (not superseded `0xB48D…`).
4. Production Next + indexer: Turnstile **secret** (host-only) + isolated signer PKs (host-only) + wallet UI ACs.
5. Flip `claimedProdPath` only after those ACs. Keep [#16](https://github.com/solarcurvey/reactor/issues/16) open until then.

See `scripts/arc-testnet-runbook.md`, `scripts/arc-testnet-checklist.md`, `docs/guardian.md`, `TESTNET_DEPLOYMENT.md`.
