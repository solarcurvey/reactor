# Keeper and Guardian matrix

> Protocol **0.2.0**. Factory **V1**. Designated Keeper. Immutable Guardian.

| Action | Guardian | Keeper | Anyone |
| --- | --- | --- | --- |
| Pause / unpause launches | Yes | No | No |
| Quarantine a quote | Yes | No | No |
| Rotate Launch Signer | Yes | No | No |
| Permanently lock a REACTOR-native ticker | Yes (matching factory token) | No | No |
| Reserve a protocol ticker | Yes (`reserveTicker`) | No | No |
| Authorize / deprecate a factory | Yes | No | No |
| Settle flywheel quote→USDC | No | Yes | No |
| Submit Top-10 epoch | No | Yes (structure-checked) | No |
| CORE / SelfBurn buy+burn | No | Yes | No |
| Withdraw LP | No | No | No |
| Change 3.5% / 2% holders / 1% / 0.5% | No | No | No — new Factory |

Leadership: **one lease** in `leader_locks` (SQLite or Postgres). Not a mix of lease OR `pg_advisory_lock`. A follower does not run jobs.

Every maintenance hop is simulated on the exact RouteGraph edge. Failed sim → job skipped. `minOut` is never 0 or 1.

Modes: `LOCAL` · `DRY_RUN` · `ARC_TESTNET`. Chain 5042 is disabled.

See `KEEPER_MODEL.md`, `GUARDIAN_MODEL.md`, `PRIVILEGE_MAP.md`.
