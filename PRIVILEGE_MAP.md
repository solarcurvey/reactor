# PRIVILEGE MAP

Every privileged function is **GUARDIAN** or **KEEPER** only. There is no Ownable, admin, bootstrap, or first-caller-wins bind.

Guardian is immutable. Keeper is replaceable by Guardian.

## Guardian-only

| Contract | Function | Notes |
| --- | --- | --- |
| `ReactorGuardian` | `setKeeper` | Replace designated Keeper |
| `ReactorGuardian` | `setPricingSigner` | Launch-pricing EIP-712 signer (starts as Keeper) |
| `ReactorGuardian` | `pauseLaunches` / `pauseKeeper` / `pauseTrading` | Brake pedal |
| `ReactorGuardian` | `setAdapter` | Reviewed routing adapters. V1 has no `setHook`. |
| `QuoteAssetRegistry` | `bindFactory` | One-time |
| `QuoteAssetRegistry` | `setUsdc` | One-time (same address may be re-set) |
| `QuoteAssetRegistry` | `register` / `setEnabled` / `setIcon` / `setBuybackRoute` | External quotes |
| `ReactorFactory` | `bindCurve` | One-time |
| `ReactorHook` | `bindFactory` / `bindBuyback` / `bindFlywheel` / `bindCurve` / `bindSelfBurn` / `bindCoreVault` | One-time each |
| `CoreVesting` | `activateLaunch` | One-time T0 freeze when constructed with `t0=0` |
| `CoreLiquidityVault` | `initializeAndLock` | One-time |
| `BuybackVault` | `bindExecutor` | One-time `CoreBuybackExecutor` |
| `ReactorLiquidityVault` | `bindFactory` | One-time |
| `BuybackVault` | `bindFactory` | One-time |
| `FlywheelVault` | `bind` | One-time |
| `ReactorRouter` | `setProtocolVault` / `sealProtocolVaults` | One-time window; sealed forever |

## Keeper-only

| Contract | Function | Notes |
| --- | --- | --- |
| `FlywheelVault` | `settleQuote` | Quote → USDC; Keeper `minOut` + per-hop `minOut` |
| `FlywheelVault` | `submitEpoch` | Structural Top-10 only |
| `FlywheelVault` | `executeTop10Buyback` | Requires `minTargetOut` |
| `FlywheelVault` | `rollEpoch` | After finalize |
| `BuybackVault` | `execute` / `executeCoreBuyback` | Requires `minOut` > 0; burns via `burn()` |
| `SelfBurnVault` | `execute` | Requires `minTargetOut` > 0; chunk + cooldown |

## One-time address assignment (no first-caller-wins)

| Slot | Who sets | After bind |
| --- | --- | --- |
| `QuoteAssetRegistry.factory` | Guardian `bindFactory` | `AlreadyBound` |
| `QuoteAssetRegistry.usdc` | Guardian `setUsdc` | Locked to that address |
| `BuybackVault.factory` | Guardian `bindFactory` | `AlreadySet` |
| `BuybackVault.curve` | Factory `setCurve` | `AlreadySet` |
| `FlywheelVault.factory` | Guardian `bind` | `AlreadyBound` |
| `FlywheelVault.curve` | Factory `setCurve` | once |
| `ReactorHook.factory` / vaults / curve / selfBurn | Guardian binds | `AlreadyBound` |
| `ReactorLiquidityVault.factory` | Guardian `bindFactory` | `AlreadyBound` |
| `ReactorLiquidityVault.curve` | Factory `bindCurve` | `AlreadyBound` |
| `ReactorFactory.curve` / `selfBurn` | Guardian `bindCurve` | `AlreadyBound` |
| `InstantCurve.selfBurn` | Factory `bindSelfBurn` | once |
| `ReactorRouter.protocolVault` | Guardian then `sealProtocolVaults` | `Sealed` — Guardian included |
| `ReactorGuardian.guardian` | Constructor immutable | never |
| `ReactorGuardian.pricingSigner` | Guardian `setPricingSigner` | replaceable, never first-caller |
| `BuybackVault.core` / hook / usdc | Constructor immutable | never |
| `UniswapV4Adapter.officialHook` | Constructor immutable | never |
| `UserRouteExecutor.auth` / hook / router / usdc | Constructor immutable | never — not a vault |

Attack suite: `test/attack/FrontrunBind.t.sol`.

## Not privileged (permissionless)

Launch (unsigned $1 / priced non-$1), bid, claim, curve buy/sell (when open and not ready-locked), graduate (when ready), official swap, `UserRouteExecutor` buy/sell, reward claim, metadata (creator, once).

## Forbidden to everyone

Withdraw official LP. Mint after construct. Change 2/1/0.5. Redirect CORE. Blacklist. Upgrade. Wallet fee-exemption. Dead-address CORE “burn”.
