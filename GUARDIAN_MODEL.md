# GUARDIAN MODEL

The Guardian is the **only** privileged security authority after deploy. It is an immutable address (production: a Safe when the chain has one; otherwise a hardware EOA). It is a brake pedal, not a steering wheel.

There is no owner, admin, proxy admin, upgrader, governor, or treasury owner.

## Construction

`ReactorGuardian.guardian` is set in the constructor and cannot change.

`keeper` starts as a backend-controlled address and **can** be replaced by the Guardian.

## Guardian MAY

| Action | Where |
| --- | --- |
| Pause / unpause launches | `pauseLaunches` |
| Pause / unpause Keeper | `pauseKeeper` |
| Replace Keeper | `setKeeper` |
| Replace launch-pricing signer | `setPricingSigner` |
| Replace Launch Signer | `setLaunchSigner` (≠ Keeper ≠ Guardian Safe) |
| Bind global ticker registry | `bindTickerRegistry` (one-time) |
| Authorize / deprecate factory versions | `authorizeFactory`, `deprecateFactory` — **new launches only** |
| Permanently lock a ticker | `permanentlyLockTicker` — one-way qualitative judgment, **not** an mcap oracle |
| Emergency trading / safe-mode pause | `pauseTrading` (curve + official v4 swaps) |
| Add / quarantine **external** quotes | `QuoteAssetRegistry.register`, `setEnabled`, `setBuybackRoute`, **`setUsdPegOne` (explicit; Stablecoins ≠ $1)**. Registering onchain does **not** price the asset. Configure `price-providers.json` / `PRICE_PROVIDERS_JSON` (≥2 independent HTTP sources where available) and confirm `/pricing/health` before treating the quote as launch-eligible. PROD never uses a static mark. |
| Add / disable reviewed routing adapters | `setAdapter` |
| Approve extra v4 hooks | **Removed in V1.** Adapters accept hookless + official REACTOR hook only. |

One-shot deploy binds (factory, hook, vaults, protocol-vault seal) are **Guardian-only**, not first-caller-wins and not a leftover bootstrap admin. After `sealProtocolVaults`, nobody — including Guardian — can add a fee-exempt wallet. See `PRIVILEGE_MAP.md`.

EOA-friendly genesis (`completeGenesis` / `finalizeGenesis`, issue **#85**): only the immutable guardian address can start. Peripherals treat `address(auth)` as guardian **only** while a transient proxy is on during those calls; `genesisSealed` then restores EOA/Safe-only binds. Safe MultiSend is unchanged. Runbook: `docs/eoa-genesis.md`.

## Guardian MUST NEVER

- Withdraw any vault or official LP
- Redirect holder rewards, SelfBurn, Top-10, or CORE
- Change the 3.5% fee or the 2 / 1 / 0.5 split
- Flip Standard ↔ Rewards
- Change a token’s quote or curve constants
- Mint, seize, or blacklist
- Alter Fair claims
- Set Top-10 members or weights
- Make CORE a Top-10 member
- Set USD prices used for ranking
- Supply arbitrary swap routes as Guardian
- Alter burn recipients
- Receive fee exemption as a wallet
- Upgrade implementations
- Arbitrary-call into vaults

`GuardianP0Test` enumerates privileged entrypoints and proves these absences.

## Trust

Guardian compromise can halt launches, trading, and maintenance, and can quarantine quotes or disable adapters. It cannot steal LP, drain reward pots, or rewrite economics. Replace the Safe signers offchain if the Guardian is lost; the address itself does not rotate.
