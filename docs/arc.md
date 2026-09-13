# Arc

REACTOR targets **Arc Public Testnet** (chain `5042002`). Arc Mainnet (`5042`) is blocked.

## Native currency

| Unit | Decimals | Role |
| --- | --- | --- |
| Native gas | **18** | USDC used as gas internally |
| USDC ERC-20 | **6** | `0x3600000000000000000000000000000000000000` — protocol quote, `usdPegOne` |

Do not treat gas-18 USDC as the ERC-20. Quote accounting is 6 decimals.

## Finality

Arc docs ([deterministic finality](https://docs.arc.io/arc/concepts/deterministic-finality)): Malachite BFT, final on commit, **no confirmation window, no reorgs**.

Indexer default `ARC_FINALITY_CONFIRMATIONS=0`. The Ethereum-style 8-block lag is dropped. Override only if you are not on Arc.

## Deploy

`pnpm arc:factory-attempt`:

- Always records RPC liveness, chain id, Factory creation/runtime sizes.
- Broadcasts **only** if `ARC_TESTNET_PK` is set, chain is 5042002, and runtime ≤ 24,576.
- `claimed` stays **false** until an explorer hash is confirmed on [testnet.arcscan.app](https://testnet.arcscan.app).
- Without a key, the JSON lists an honest blocker checklist (Circle faucet → key → re-run → explorer). Same content: `deployments/arc-testnet-blocker.md` and `scripts/arc-testnet-checklist.md`. **claimed stays false.**

PoolManager is **not** deployed on Arc Public Testnet as of this release. Local Anvil 5042002 ships official v4-core (BUSL, non-production).

## Multicall3

Canonical Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) is **not assumed** on Arc. `readContractsBatched` probes bytecode, requires one successful `multicall`, and otherwise runs independent `readContract` calls in parallel. Anvil usually has the contract; Arc testnet may not. See [Read path performance](/docs/perf).
