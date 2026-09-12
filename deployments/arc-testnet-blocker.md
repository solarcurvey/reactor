# Arc Public Testnet — Factory not claimed

**claimed: false**  
This environment has **no `ARC_TESTNET_PK`**. No `eth_sendRawTransaction` was attempted. Do not invent explorer hashes.

Source probe: `deployments/arc-factory-attempt.json` (RPC live, Factory sizes recorded, estimate may revert on dummy ctor).

## Why this is blocked

| Requirement | Status |
| --- | --- |
| Arc Public Testnet RPC `https://rpc.testnet.arc.io` | Live (see attempt JSON `head`) |
| Chain id `5042002` | Verified |
| Factory runtime ≤ EIP-170 24,576 | Recorded in attempt JSON / `pnpm size:guard` |
| Funded EOA private key `ARC_TESTNET_PK` | **Missing or unfunded** (disposable `cast wallet new` address is in `deployments/arc-testnet-rehearsal.md`) |
| Circle faucet drip | **Blocked** — GraphQL `RECAPTCHA_ERROR` (`ReCAPTCHA verification failed`) from this VM. Developer `/v1/faucet/drips` is HTTP 401 without an API key. |
| Explorer confirmation on [testnet.arcscan.app](https://testnet.arcscan.app) | **None** |
| Uniswap v4 PoolManager on Arc Public Testnet | **Not deployed** (protocol dependency) |

## Exact commands (when a funded key exists)

```bash
# 1. Fund an EOA on Arc Public Testnet (5042002)
#    Faucet: https://faucet.circle.com
#    Native gas is USDC-18. Protocol quote USDC is 0x3600…0000 (6 decimals).

# 2. Never commit the key
export ARC_TESTNET_PK=0x…          # funded EOA, not Anvil #0
export ARC_TESTNET_RPC=https://rpc.testnet.arc.io
export PATH="$PATH:$HOME/.foundry/bin"

# 3. Build + size gate
cd contracts && forge build --sizes && cd ..
pnpm size:guard

# 4. Probe + broadcast Factory create only if runtime ≤ 24576
pnpm arc:factory-attempt
# writes deployments/arc-factory-attempt.json
# claimed stays false until you confirm the explorer receipt

# 5. Full protocol (dependencies + Factory) — only after PoolManager exists on 5042002
#    or you deploy official v4-core yourself (BUSL non-production)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_TESTNET_RPC" \
  --broadcast --legacy \
  --private-key "$ARC_TESTNET_PK"

# 6. Production-shaped genesis (Guardian = Safe ≠ deployer)
export SAFE_GENESIS=true
export GUARDIAN=0x…Safe
export KEEPER=0x…Keeper
# then Safe Transaction Builder: pnpm safe:genesis
# Batch A → forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url $ARC_TESTNET_RPC
# → Batch B (pauseLaunches(false) LAST)
```

## Addresses you must record before claiming

Do **not** fill these until they appear on [testnet.arcscan.app](https://testnet.arcscan.app):

- PoolManager (v4-core)
- ReactorGuardian (immutable `guardian` = Safe)
- TickerRegistry
- QuoteAssetRegistry
- CoreToken (name REACTOR CORE / symbol CORE; `TestCORE` is a deprecated alias)
- ReactorFactory V1 + InstantLaunchModule
- InstantCurve, ReactorHook, UserRouteExecutor, UserRouteQuoter
- Vaults (LP, Flywheel, Buyback, SelfBurn, FairClaim, CoreVesting, CoreLiquidityVault)

Canonical Arc USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals).  
Native gas: USDC-18. Do not treat gas units as the protocol quote.

## Still blocked after a key exists

- **Arc Mainnet (5042)** — hard blocked. No addresses.
- **Independent Codex / professional audit** — not claimed.
- **Top-10 as an onchain oracle** — frozen offchain by design.
- **Factory claimed:true** — only after an explorer hash is in `deployments/arc-factory-attempt.json` and a human confirms the receipt.

See `scripts/arc-testnet-checklist.md` and `TESTNET_DEPLOYMENT.md`.
