# TESTING

## Commands

```bash
cd contracts
export PATH="$PATH:$HOME/.foundry/bin"

forge test -vv
forge test --fuzz-runs 256
forge test --match-path test/invariant/RewardCampaign.t.sol -vv
# Do not treat test/unit/FeeInvariant.t.sol or test/invariant/Rewards.t.sol as stateful invariants.
forge test --match-path test/attack/* -vv
forge test --match-path test/integration/* -vv
```

Static analysis (optional, when slither is installed):

```bash
slither contracts/src --exclude-dependencies || true
```

## Required suites

| Area | File | Asserts |
| --- | --- | --- |
| Guardian / Keeper / routing P0 §42 | `test/unit/GuardianP0.t.sol` | 40 routing/vault/Keeper/Guardian cases + privileged surface |
| Top-10 API §43 | `test/unit/Top10Api.t.sol` | skip ungraduated/CORE/unreliable; weights 100%; onchain structural reject |
| Top-10 / Keeper security | `test/attack/Top10Security.t.sol` | structural submit, CORE skip, double submit/exec, #11 reject, <10 split, buckets |
| Top-10 + CORE E2E burns | `test/integration/Top10E2E.t.sol` | `totalSupply` decreases after Keeper Top-10 / CORE buy+burn |
| Fee 3.5% → 2/1/0.5 | `test/unit/FeeInvariant.t.sol` | holders+flywheel+core = 3.5% floor split |
| Reward solvency | `test/invariant/RewardSolvency.t.sol` | legacy over-assigns; magnified DPS never does |
| No transfer tax | `test/unit/Token.t.sol` | send X, receive X |
| Reward solvency | invariant + unit | token quote + hook pending ≥ outstanding (acc-snapshot debt; 1-raw campaign slack) |
| Reward persistence | unit | accrue, transfer to 0, still claimable |
| No future-reward theft | unit | recipient debt = current acc |
| Pool exclusion | unit | PM balance not eligible |
| Liquidity lock | unit | remove reverts; creator cannot reclaim |
| Fixed supply | unit | mint after construct reverts (no function) |
| Fair 0% during CCA | integration | vault/token quote unchanged by bids |
| Migration once | integration | second finalize reverts |
| Hook-only economics | integration | hookless swap accrues 0 |
| Buyback no redirect | unit | CORE target immutable |
| Reentrancy | attack | claim/buyback/finalize |
| Exact-in/out edges | unit hook | four quadrants × two sort orders |
| Rounding / dust | fuzz | fee 0 on dust; no overflow |
| Double claim | unit | second claim = 0 |
| Balance hopping | unit | transfer mid-acc |
| Flash / sandwich | attack | documented, no insolvency |
| FoT quote | attack | shortfall reverts |
| USDC 6 vs 18 | unit | raw-unit math |
| CREATE2 hook bits | unit | mined address matches flags |
| Unauthorized notify | unit | only hook credits |
| Stuck funds / DoS | attack | leftover rewards when eligible=0 |

## Arc smoke

`test/integration/ArcSmoke.t.sol` runs against the local Arc-compatible chain id and 6-decimal quote. A live RPC smoke (`--rpc-url $ARC_TESTNET_RPC`) is opt-in and must not be required for CI.

## E2E demo

```bash
pnpm --filter indexer demo   # viem + Anvil; writes deployments/e2e-evidence.json
```

Optional Foundry sketch: `contracts/script/DemoE2E.s.sol`. See `BUILD_REPORT.md`.
