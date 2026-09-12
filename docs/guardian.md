# Guardian

The only privileged security authority. Immutable in `ReactorGuardian`.

## Can

- Pause launches and trading
- Quarantine quote assets
- Rotate launch signer and pricing signer (distinct from Keeper rotate)
- Authorize / deprecate factories (new launches only; existing tokens keep their Factory version)
- Permanently lock tickers (REACTOR-native, matching ticker; not during another token’s 24h lock)
- Run Safe genesis batches

## Cannot

- Withdraw locked LP
- Rewrite the 2 / 1 / 0.5 split
- Rank Top-10 onchain
- Mint launch tokens
- Blacklist holders

**Deployer ≠ Guardian.** After genesis the deployer EOA has no protocol role.

## Safe Transaction Builder

Template: `deployments/safe-genesis-builder.json` (regenerate with `tsx scripts/safe-genesis-builder.ts`).

1. Deploy contracts while launches are paused.
2. Batch A (Guardian Safe): binds, signer, quote registry, CORE genesis — **not** `pauseLaunches(false)`.
3. `VerifyGenesis` / auditor checklist.
4. Batch B T0: `pauseLaunches(false)` **last**.

See `GUARDIAN_MODEL.md`, `PRIVILEGE_MAP.md`, [Keeper](/docs/keeper).
