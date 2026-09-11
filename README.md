# REACTOR

**Launch. Reflect. Burn.**  
**Choose what your token earns.** Launch markets that pay holders in the quote you pick.

Permissionless token launchpad for **Arc**. Official REACTOR pools are Uniswap v4 markets with a **0% LP fee** and a **3% quote-side protocol charge** (2% holders / 1% CORE buyback-and-burn). Built on Arc.

> This repository is **not audited**. Do not deploy to Arc Mainnet (chain 5042).

## Quick start (local Arc-compatible demo)

```bash
# Foundry
export PATH="$PATH:$HOME/.foundry/bin"
cd contracts
forge install   # v4-core e50237c4…, v4-periphery dce236d4…, forge-std
forge test

# Chain + protocol
cd ..
anvil --chain-id 5042002 --port 8545
# new terminal
cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast

# Apps
pnpm install
pnpm --filter indexer dev
pnpm --filter web dev
```

Open `http://127.0.0.1:43147`. Connect a wallet to **chain 5042002** (Anvil). Import anvil account 0 if needed.

Addresses land in `deployments/local.json` after the demo script.

## What you can do

1. **Choose a quote** — Instant (market live immediately) or **Batch Fair Launch** (pro-rata timed sale → migrate). Not Uniswap CCA.
2. Trade **exact-in** on the Official REACTOR Pool. The UI simulates, applies slippage, and submits a **nonzero minOut**. Incomplete fills revert.
3. Claim holder rewards in the quote asset — no staking.
4. Permissionless CORE buyback. Callers cannot set minOut; the protocol enforces TWAP-style reference, cooldown, chunk, and reserve.
5. Transfer launch tokens with **zero tax**; rewards persist.

## Network

| | Arc Public Testnet | This demo |
| --- | --- | --- |
| Chain ID | 5042002 (verified) | 5042002 |
| RPC | https://rpc.testnet.arc.io (live) | local anvil |
| USDC | `0x3600…0000` 6 decimals | Mock USDC-6 |
| v4 PoolManager | **not deployed** | Official v4-core, BUSL non-production |

We **do not claim Arc Testnet success** unless transactions appear on [testnet.arcscan.app](https://testnet.arcscan.app).

## Docs

| File | Contents |
| --- | --- |
| `PROJECT.md` | Product scope |
| `ARCHITECTURE.md` | Modules and trust boundaries |
| `ECONOMICS.md` | Immutable 2/1 split, eligibility |
| `DECISIONS.md` | ADRs + primary-source research |
| `THREAT_MODEL.md` | Attacks and residual risk |
| `TESTING.md` | How to test |
| `TESTNET_DEPLOYMENT.md` | Verified Arc params |
| `AUDIT_HANDOFF.md` | Hostile-reader brief |
| `AGENTS.md` | Invariants for future agents |
| `BUILD_REPORT.md` | Evidence for this build |
| `COMPETITIVE_REVIEW.md` | Dated public-source review |
| `FUTURE.md` | Explicitly not built |
| `HARDENING_REPORT.md` | P0/P1 findings and proof |

## License

REACTOR contracts: MIT.  
Uniswap v4-core: BUSL-1.1 (non-production use until 2027-06-15). See `DECISIONS.md` ADR-005.
