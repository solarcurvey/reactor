# BUILD REPORT — REACTOR local Arc-compatible MVP

**Status:** Final Grok completion pass on branch `cursor/final-grok-completion-5e6c`. Architecture/tokenomics frozen. Local Anvil 5042002 only. Hook bytecode changes — **re-read `factory.hook()` after redeploy**.  
**Not audited. Not mainnet. Not production-ready. Arc Public Testnet not claimed.** See `HARDENING_REPORT.md` and `AUDIT_HANDOFF.md`.

## This HEAD (final completion)

| Item | Value |
| --- | --- |
| Branch | `cursor/final-grok-completion-5e6c` |
| Parent | `1a3b3b6` |
| Forge | re-run this pass (`via_ir`); count in the commit message / below after CI |
| Invariants | Reward campaign + CORE + fee split still the bound |
| Frontend | Search + rows, image file upload, RoutePlanner trade preview, PRICE 1m/5m/1h/4h/1d bonding→v4, denser ops |
| Backend / indexer | `block.timestamp` swaps; durable `pools`; `/candles` `/ops` `/vwap` |
| Keeper | Vault return values; `conservativeMinOut`; dynamic quotes; RoutePlanner; DRY_RUN/LOCAL/ARC_TESTNET; no 5042 |
| Watchdog | Independent eval + alerts file; no Guardian keys |
| E2E | `CurrentArchitecture.t.sol` + `e2e-current-architecture.ts` (old 3% demo retired) |
| Screenshots | Existing `review/*` from prior regen; recapture after local Anvil if UI changes |
| Limitations | No live Arc Testnet txs. Intermediate hop floors reuse last-leg minOut (Codex residual). No prod image store. |
| Arc Testnet | **Not claimed.** Chain id 5042002 locally only. |
| Mainnet blockers | BUSL v4-core, no PoolManager on 5042, no audit, no native USDC dual-decimal, Instant/CCA not compatible |

### What this pass fixed

1. Maintenance fns return `burnedAmount` / `coreBought` / `targetBought` / `usdcReceived`. Keeper reads `simulateContract().result`. No fake TS returns.
2. Production minOut never 0/1. Weak sim skips the job.
3. Canonical RoutePlanner + ValuationEngine (`packages/reactor`).
4. Dynamic quote discovery (registry + factory), not `[USDC, ZEC]`.
5. Nested protocol settle / Top-10 fee-exempt; user path still 3.5%.
6. Router `nonReentrant` + `WalletExemptForbidden` while `protocolExempt`.
7. Indexer timestamps = chain time; VWAP uses chain head; restart reconstructs `poolId→token`.
8. Top-10 fail-closed only on **material** uncertainty.
9. usdPegOne-only $1; unique launch digest; Safe genesis verify script.

Evidence file: `deployments/e2e-evidence.json` (regenerate with `pnpm --filter indexer demo` after a fresh deploy).

# BUILD REPORT — prior local MVP notes


Evidence file: `deployments/e2e-evidence.json` (regenerate with `pnpm --filter indexer demo` after a fresh deploy).

## What shipped

| Slice | Location |
| --- | --- |
| Instant bonding → ready-lock → graduate → locked v4 | `InstantCurve` + priced/unsigned factory launch |
| Batch Fair Launch (pro-rata timed sale, not CCA) | `ReactorFactory` + `FairClaimVault` |
| Holder rewards (O(1); genesis 2% → SelfBurn if eligible=0) | `ReactorToken` + `SelfBurnVault` |
| CORE genesis 100M vest + 900M locked official CORE/USDC | `CoreVesting` + `CoreLiquidityVault` |
| CORE buy+burn via `burn()` only; official book 2.5/1.0 | `BuybackVault` + `CoreBuybackExecutor` |
| Top-10 flywheel (1%; offchain discovery, structural onchain) | `FlywheelVault` + `apps/web` marketdata API |
| User USDC router (bonding + graduated; not a vault) | `UserRouteExecutor` |
| Protocol fee-exempt hops | `ProtocolV4Adapter` |
| Designated Keeper + immutable Guardian | `ReactorGuardian` |
| Consumer UI (compact Instant, no FDV slider) | `apps/web` @ `http://127.0.0.1:43147` |
| Indexer + keeper daemon + watchdog | `apps/indexer` |

## Addresses (local)

| Contract | Address |
| --- | --- |
| PoolManager | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| QuoteAssetRegistry | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| TestCORE | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| USDC (mock 6) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| ZEC (mock 8) | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| ReactorLiquidityVault | `0x0B306BF915C4d645ff596e518fAf3F9669b97016` |
| ReactorRouter | `0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1` |
| ReactorHook | `0x27Cf52D1606345AaE2837c4a667fD57C68B9B0cc` (flags `0x30CC`) |
| BuybackVault | `0x68B1D87F95878fE05B998F19b66F4baba5De1aed` |
| ReactorFactory | `0xc6e7DF5E7b4f2A278906862b61205850344D4e7d` |

Hook CREATE2 address **changes if hook bytecode changes**. Always read `factory.hook()`.

## E2E steps 1–23

| # | Result | Evidence |
| --- | --- | --- |
| 1 Connect wallets | Anvil 0–3 | deployer `0xf39F…`, alice `0x7099…`, bob `0x3C44…`, carol `0x90F7…` |
| 2 Deploy/verify | Factory code present | 38474 hex chars |
| 3 TestCORE | 1e9 × 1e18 | `0x9fE4…` |
| 4 CORE liquidity | Hookless CORE/USDC seeded | PM holds ~5e6 CORE |
| 5 Register USDC | enabled | mock 6-dec |
| 6 Register Mock ZEC | enabled | mock 8-dec |
| 7 Instant ZCAT/ZEC | live | token `0x553BED26A78b94862e53945941e4ad6E4F2497da` pool `0x2ffbfbc6603aee92647bd3669a5278cbbaf7a1aaea8730beae1b36d886e2db5c` tx `0xe5658c69…` |
| 8 Multi-wallet buy | alice 3000 ZEC, bob 2000 ZEC | txs `0x587e97d3…`, `0x67deddbe…` |
| 9 Sell | alice sold 25% | `0x0f23913a…` |
| 10 ZEC → rewards | alice pending `10960737387` | lifetime `11564651717` ≥ 2% of buys (`10000000000`) |
| 11 Buyback reserve | ZEC `5782325858` | pending — no ZEC/CORE route |
| 12 Tax-free transfer | delta == sent | `0xecf80d5a…` |
| 13 Trade after transfer | carol rewards 0 → `54403230` | `0x9c6f96c1…` |
| 14 Claim | success | `0x72e79876…` |
| 15 Execute buyback | USDC vault `100000000` = expected 1% of 10000e6 | UCAT `0x624dC0Ec…` |
| 16 CORE burned | `99698012021646250883` (~99.70 CORE) | `0xd2676007…` |
| 17 Fair FCAT | fairId 1 | `0x94cD1b4D…` tx `0x52a10e63…` |
| 18 Multi bids | 1000 + 2000 ZEC | buyback **unchanged** during auction |
| 19 Finalize | marketLive | `0xa7d8cb2e…` |
| 20 Migrate | pool `0x8f840150366ed9da56a5c50c399556cde6de11cfea59f5eb45c49fba5fe46a67` | once |
| 21 Post-migration trade | carol 200 ZEC | `0xe66795bb…` |
| 22 3% only after | buyback Δ `200000000` = 1% of 200e8 | auction charged `false` |
| 23 UI = chain | factory/token/vault views | no fabricated stats |

## Fee arithmetic (expected vs actual)

Split: `holders = n * 200 / 10000`, `flywheel = n * 100 / 10000`, `core = n * 50 / 10000` (3.5% total). Legacy E2E rows below still show the old 2%/1% CORE-only column labels — treat the 1% column as flywheel+core (1.5%) after the 3.5% cut.

| Swap | Notional (raw) | Expected 2% | Expected 1% | Observed |
| --- | --- | --- | --- | --- |
| Alice buy ZCAT | 3000e8 | 6000000000 | 3000000000 | included in lifetime / ZEC reserve |
| Bob buy ZCAT | 2000e8 | 4000000000 | 2000000000 | same |
| Buys combined | 5000e8 | 10000000000 | 5000000000 | lifetime ≥ 10000000000; ZEC reserve ≥ 5000000000 (plus sell share) |
| Alice UCAT buy | 10000e6 | 200000000 | 100000000 | vault USDC **100000000** exact |
| FCAT auction bids | 3000e8 | 0 | 0 | buyback unchanged |
| FCAT post-migrate buy | 200e8 | 400000000 | 200000000 | buyback Δ **200000000** exact |

## Tests

```
forge test   # 260 passed, 0 failed, 1 skipped (cross-quote historical reproduce)
```

Solvency after flush: token quote balance ≥ outstanding holder rewards (no +1 slack). Flywheel and CORE pots are isolated. Top-10 E2E asserts `token.totalSupply()` and `core.totalSupply()` decrease after execute.

Static analysis: Slither 0.11.6 re-run on this HEAD — **142 results** (16 High / 64 Medium / 54 Low / 8 Info). See `HARDENING_REPORT.md`. Not clean. Not an audit.

## Dependencies

| Package | Pin |
| --- | --- |
| Uniswap/v4-core | `e50237c43811bd9b526eff40f26772152a42daba` |
| Uniswap/v4-periphery | `dce236d4e2057422d0791d9a973a58765eb46f65` |
| forge-std | `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b` |
| Foundry | 1.8.1 |
| Next.js | 15.5.4 |
| viem / wagmi | 2.56.3 / 3.7.7 |

`cd contracts && forge install` (libs gitignored).

## Deviations (reversible)

1. **Fair launch** is CCA-inspired inside `ReactorFactory`, not Uniswap CCA factory → official hooked pool (ADR-002).
2. **Instant launch** is a REACTOR strategy, not InstantLaunchStrategy (ADR-001).
3. **Success path is local Anvil**, chain id 5042002. Do not claim Arc Testnet.
4. **Buyback route is USDC-only.** ZEC (and other) reserves stay pending.
5. **Fee claims** are ERC-6909 during the swap; `ReactorRouter` flushes **after** unlock (burn 6909 then take ERC-20). Hook bytecode changes move the CREATE2 hook address.
6. Metadata images are local `/icons/*.svg` (dev adapter). No IPFS/S3.

## Not built (by brief)

Social, DMs, NFTs, governance, referrals, creator royalties, platform trading revenue, anti-external-pool, CORE staking, bridges, perps, native mobile, profiles.
