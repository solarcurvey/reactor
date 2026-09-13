# Arc Public Testnet — SUPERSEDED 2026-09-12 dump (non-PROD-isolated)

**Historical claimed: true** on Blockscout API (`result=success`). **SUPERSEDED** for isolated PROD-path. Keep #16 open.

ReactorGuardian `0x2CdF37541256749E5CF6ac5C806e0d23A685F224` / Factory `0xB48D1B397834eBcccb8961041d827487097e0535` have immutable `guardian()` = lost disposable `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E` (same as launchSigner / pricingSigner / keeper). Guardian cannot rotate. Davis chose REDEPLOY. Isolated constructors are live: Guardian `0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934`, Factory `0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA` (`deployments/arc-testnet-isolated.json`). HW genesis + Instant/Fair smoke pending. Runbook: `scripts/arc-testnet-eoa-genesis-runbook.md`.

This file previously recorded the Circle faucet `RECAPTCHA_ERROR` blocker. Funding arrived from a box throwaway wallet onto `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E`. Full stack + Instant/Fair smoke for the **old** dump are in `deployments/arc-testnet.json` and `deployments/arc-testnet-smoke.json`.

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
