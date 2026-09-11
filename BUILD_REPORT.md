# BUILD REPORT — REACTOR local Arc-compatible MVP

**Status:** Hardening pass on the existing repo. Prior MVP loop was local Anvil 5042002. Hook bytecode changed — **re-read `factory.hook()` after redeploy**.  
**Arc Public Testnet:** still not claimed. See `HARDENING_REPORT.md`.

Evidence file: `deployments/e2e-evidence.json`  
Run at: 2026-09-11T00:37:56Z

## What shipped

| Slice | Location |
| --- | --- |
| Instant launch (v4 from trade #1, 0% LP, hooked) | `ReactorFactory.instantLaunch` |
| Batch Fair Launch (pro-rata timed sale, not CCA) | `ReactorFactory` + `FairClaimVault` |
| Holder rewards (O(1), no staking, persist on transfer) | `ReactorToken` |
| CORE buyback-and-burn (accrue, permissionless execute) | `BuybackVault` + hookless CORE/USDC |
| Consumer UI | `apps/web` @ `http://127.0.0.1:43147` |
| Indexer | `apps/indexer` @ `:43148` |

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

Split: `holders = n * 200 / 10000`, `buyback = n * 100 / 10000`.

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
forge test   # 27 passed (unit, fuzz, invariant, integration, attack, Arc smoke)
```

Solvency after flush: token quote balance ≥ `lifetimeRewards`; buyback ERC-20 ≥ `accrued`.

Static analysis: Slither was not run in this environment (optional). Re-run with `slither contracts/src` before any audit.

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
