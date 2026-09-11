# Deployments

| Network | Chain ID | Status |
| --- | --- | --- |
| Local Anvil | 5042002 | Supported demo |
| Arc Public Testnet | 5042002 | Params documented; **do not claim success** without explorer txs |
| Arc Mainnet | 5042 | **Blocked** — Codex + audits + KMS/Safe rehearsal |

v4 `PoolManager`: production accepts **verified** Arc addresses only. This repo does not hardcode a mainnet or unverified testnet PoolManager.

SAFE genesis: Batch A (config while paused, including Launch Signer + TickerRegistry + authorizeFactory) → Verify → Batch B (vesting T0 + `pauseLaunches(false)`).
