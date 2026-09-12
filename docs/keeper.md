# Keeper

Designated Keeper. Not permissionless. Not a bounty. Not Guardian.

## Leadership

**One** mechanism: `leader_locks`. Acquire is `UPDATE … RETURNING` (Postgres) or a Store transaction (`BEGIN IMMEDIATE` on SQLite). Do not mix this with `pg_advisory_lock` as a second leader.

The ~50s TTL (`KEEPER_LEASE_TTL_MS`, default 50_000) is a **dead-leader failover**, not a work budget. A tick can run longer than that (`waitForTransactionReceipt` timeout is 60s; discovery/sim loops scale with markets). A live leader **renews** `lease_until` on an interval (`KEEPER_LEASE_RENEW_MS`, default 15_000) and again immediately before every broadcast. Renew keeps the acquire-generation fence (`leader_locks.ts`) unchanged. Each acquire mints a **monotonic** fence (`max(now, prev.ts+1)`) so two acquires in the same millisecond are still distinct generations.

If renew fails (expiry without renewal, or another owner stole after expiry) the process **refuses to send**. It does not re-acquire mid-tick. The next loop may become leader. That is the split-brain fence.

## Operations

| Concern | Rule |
| --- | --- |
| Overlapping daemons | Only the row owner+fence may send. Standby writes `standby — not leader` and does not broadcast. |
| Long tick | Background renew + pre-send renew. Do not raise TTL to “cover” work; that delays failover. |
| Lost lease mid-tick | Fail closed for further jobs. Heartbeat reason `leader lease lost — refuse broadcast`. Not a protocol pause. |
| Release | `DELETE … owner AND ts=fence` so a stale finally cannot drop a newer generation. |
| Watchdog | Independent process. Separate keys. Checks heartbeat + on-chain epoch, not this lease row. |
| Two workers | Production proof is **two independent Postgres pools**, not one SQLite `Store`. `pnpm --filter indexer test:pg-lease` (CI job `keeper-lease-pg`). Simultaneous acquire has one winner; a renewing leader cannot be overlapped; expiry/crash lets the standby take a new fence; the stale generation cannot renew, drop the new row, or send. |

`leader_locks.ts`, `leader_locks.lease_until`, and `keeper_operations.ts` are **milliseconds** (`Date.now()` / `Date.now() + ttlMs`), `BIGINT` on Postgres. On-chain Keeper work still uses `block.timestamp` seconds. A 32-bit INTEGER column overflows today's `Date.now()` (~1.8e12).

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
