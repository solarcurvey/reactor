# Events

| Event | Where | Notes |
| --- | --- | --- |
| TokenCreated / LaunchCreated / InstantLaunchCreated | Factory | Metadata + quote |
| LaunchAuthorized | Factory | ticker, authId, factoryVersion |
| OfficialPoolCreated | Factory `(token, poolId, mode)` **and** Hook `(poolId, token, quote)` | Indexer listens to both |
| TickerClaimed / TickerPermanentlyLocked | TickerRegistry | Global identity |
| CurveBuy / CurveSell / BondingProgress / GraduationCompleted | Curve | Bonding tape |
| SwapFeeAccrued | Hook | Official v4 notional + split |
| EpochSubmitted / Top10Buy | Flywheel | Structural epoch |

Trade uniqueness: `chainId + tx + logIndex`.
