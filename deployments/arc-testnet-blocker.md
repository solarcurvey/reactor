# Arc Public Testnet — Factory claimed on explorer (#16 rehearsal)

**claimed: true** on Blockscout API (`result=success`). Keep #16 open for human AC.

This file previously recorded the Circle faucet `RECAPTCHA_ERROR` blocker. Funding arrived from a box throwaway wallet onto `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E`. Full stack + Instant/Fair smoke are in `deployments/arc-testnet.json` and `deployments/arc-testnet-smoke.json`.

| Requirement | Status |
| --- | --- |
| Arc Public Testnet RPC | Live (`https://rpc.testnet.arc.network`) |
| Chain id `5042002` | Verified |
| Factory runtime ≤ 23,552 / EIP-170 | 23,286 bytes |
| Funded disposable EOA | **Yes** (~10 native USDC-18; PK never committed) |
| Circle faucet drip | Still `RECAPTCHA_ERROR` from this VM |
| Explorer confirmation | Factory create + Instant/Fair smoke `result=success` |
| Uniswap v4 PoolManager (Circle/Uniswap canonical) | Still unpublished — rehearsal deployed official v4-core BUSL |

Do not invent mainnet (5042) addresses.
