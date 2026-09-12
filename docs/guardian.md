# Guardian

The only privileged security authority. Immutable in `ReactorGuardian`.

## Can

- Pause launches and trading
- Quarantine quote assets
- Add **external** quotes onchain — then configure offchain price providers **before** the quote is launch-eligible (see below)
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

## External quote pricing (required before launch eligibility)

Onchain `QuoteAssetRegistry.register` does **not** create a USD mark. Before the quote can authorize Instant/Fair launches or contribute a material Top-10 mark:

1. Guardian registers the token (`setUsdPegOne` only if it is really $1; Stablecoins ≠ $1).
2. Operator adds the canonical address to `apps/indexer/config/price-providers.json` or `PRICE_PROVIDERS_JSON` with **≥2 independent HTTP sources** where available (`ZEC_*` / `WBTC_*` env slots or generic URLs + parser).
3. Confirm `GET /pricing/health` shows consensus `ok` and the watchdog is not alerting `price_consensus`.
4. Only then treat the quote as launch-eligible. Missing providers persist `ok=0` and the signer refuses authorization. PROD never uses a static dollar.

See [Valuation](/docs/valuation), `GUARDIAN_MODEL.md`.

## Safe Transaction Builder

Template: `deployments/safe-genesis-builder.json` (regenerate with `tsx scripts/safe-genesis-builder.ts`).

1. Deploy contracts while launches are paused.
2. Batch A (Guardian Safe): binds, signer, quote registry, CORE genesis — **not** `pauseLaunches(false)`.
3. `VerifyGenesis` / auditor checklist.
4. Batch B T0: `pauseLaunches(false)` **last**.

See `GUARDIAN_MODEL.md`, `PRIVILEGE_MAP.md`, [Keeper](/docs/keeper).
