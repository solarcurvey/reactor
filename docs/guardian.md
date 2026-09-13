# Guardian

> The only privileged security authority. Immutable in `ReactorGuardian`. Brake pedal, not steering wheel.

Production Guardian is a Safe. The address itself does not rotate; replace Safe signers offchain if the Guardian is lost. **Deployer ≠ Guardian.** After genesis the deployer EOA has no protocol role.

There is no owner, admin, proxy admin, upgrader, governor, or treasury owner. See [Security](/docs/security) and `GUARDIAN_MODEL.md`.

## Can

- Pause / unpause launches (`pauseLaunches`)
- Pause / unpause Keeper (`pauseKeeper`)
- Emergency trading / safe-mode pause (`pauseTrading` — curve + official v4 swaps)
- Replace Keeper (`setKeeper`) — designated Keeper on current `main`; `AutomationGateway` is draft **#54**
- Rotate launch-pricing / launch signers (distinct from Keeper). Gateway `jobSigner` rotate lands with **#54**
- Replace launch-pricing signer (`setPricingSigner`)
- Replace Launch Signer (`setLaunchSigner`, ≠ Keeper ≠ Guardian Safe)
- Bind global ticker registry (`bindTickerRegistry`, one-time)
- Authorize / deprecate factories (`authorizeFactory` / `deprecateFactory`) — **new launches only**; existing tokens keep their Factory version
- Permanently lock tickers (REACTOR-native, matching ticker; not during another token’s 24h lock)
- Add / quarantine **external** quotes (`QuoteAssetRegistry.register`, `setEnabled`, `setBuybackRoute`, **`setUsdPegOne`**)
- Add / disable reviewed routing adapters (`setAdapter`)
- One-shot deploy binds (factory, hook, vaults, protocol-vault seal) — Guardian-only, not first-caller-wins
- Run Safe genesis batches
- `CoreVesting.activateLaunch()` once when constructed with `t0=0`

Approve extra v4 hooks was **removed in V1**. Adapters accept hookless + official REACTOR hook only. There is no `setHook`.

## Cannot

- Withdraw locked LP or any vault
- Rewrite the 2 / 1 / 0.5 split or the 3.5% fee
- Rank Top-10 onchain or set USD prices used for ranking
- Mint launch tokens or CORE after genesis
- Blacklist holders
- Flip Standard ↔ Rewards
- Change a token’s quote or curve constants
- Alter Fair claims
- Make CORE a Top-10 member
- Receive fee exemption as a wallet
- Upgrade implementations
- Arbitrary-call into vaults

After `sealProtocolVaults`, nobody — including Guardian — can add a fee-exempt wallet.

## External quote pricing (required before launch eligibility)

Onchain `QuoteAssetRegistry.register` does **not** create a USD mark. Before the quote can authorize Instant/Fair launches or contribute a material Top-10 mark:

1. Guardian registers the token (`setUsdPegOne` only if it is really $1; Stablecoins ≠ $1).
2. Operator adds the canonical address to `apps/indexer/config/price-providers.json` or `PRICE_PROVIDERS_JSON` with **≥2 independent HTTP sources** where available (`ZEC_*` / `WBTC_*` env slots or generic URLs + parser).
3. Confirm `GET /pricing/health` shows consensus `ok` and the watchdog is not alerting `price_consensus`.
4. Only then treat the quote as launch-eligible. Missing providers persist `ok=0` and the signer refuses authorization. PROD never uses a static dollar.

See [Valuation](/docs/valuation).

## Safe Transaction Builder

Template: `deployments/safe-genesis-builder.json` (regenerate with `tsx scripts/safe-genesis-builder.ts` / `pnpm safe:genesis`).

1. Deploy contracts while launches are paused.
2. Batch A (Guardian Safe): binds, signer, quote registry, CORE genesis — **not** `pauseLaunches(false)`.
3. `VerifyGenesis` / auditor checklist.
4. Batch B T0: vesting T0 + `pauseLaunches(false)` **last**.

See `PRIVILEGE_MAP.md`, [Keeper](/docs/keeper), [Deployments](/docs/deployments).
