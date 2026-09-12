# Keeper

Designated Keeper. Not permissionless. Not a bounty. Not Guardian.

## Leadership

**One** mechanism: `leader_locks.lease_until`. Acquire is `UPDATE … RETURNING` (Postgres) or a Store transaction (`BEGIN IMMEDIATE` on SQLite). Do not mix this with `pg_advisory_lock` as a second leader.

## Jobs

Each job takes a **20% chunk** + cooldown. The Keeper supplies `minOut` from a **whole-route, fee-exempt** preview (`planFeeExemptRoute` + ProtocolV4Adapter). That path never shares `UserRouteQuoter`. Successful quotes refuse `minOut` 0 or 1.

Top-10 jobs execute the **frozen onchain epoch**, not the latest API snapshot.

`submitOnce` — if the RPC is ambiguous (timeout after broadcast), do not resubmit.

## Modes

| Mode | Meaning |
| --- | --- |
| `LOCAL` | Anvil 5042002 |
| `DRY_RUN` | Simulate only |
| `ARC_TESTNET` | Chain 5042002 public RPC |

Arc Mainnet **5042 is disabled** in Keeper and deploy scripts.

Independent `watchdog` process checks heartbeat + on-chain epoch. See `KEEPER_MODEL.md`, [Trust](/docs/trust), [Quoting](/docs/quoting).
