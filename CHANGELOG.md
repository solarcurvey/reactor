# Changelog

All **production** REACTOR protocol releases are listed here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning: [Semantic Versioning](https://semver.org/) for the **protocol release**. Factory versions are separate and immutable.

- Protocol source of truth: `docs/version.json` (`protocolVersion`)
- Git tag: `vMAJOR.MINOR.PATCH` (see [Versioning](docs/versioning.md) and `CONTRIBUTING.md`)
- Factory **V1 stays V1 forever**. A new fee split or curve is Factory V2, not a protocol patch.

## [0.2.0] - 2026-09-12

Material platform correctness pass. Tokenomics **unchanged**: official 3.5% quote-side charge (2% holders / 1% Top-10 / 0.5% CORE), 1B / 18 supply, Dev Buy ≤5% token-out, 24h global ticker lock. Factory **V1**.

### Added / Changed

- Launch admission is mandatory before any `LaunchAuthorization`. Public `POST /launch/authorize` → admission → ALLOW receipt → isolated signer. CHALLENGE ≠ ALLOW. Direct signer bypass fails.
- Durable anti-spam in Postgres/SQLite (rates, challenges, image hashes, issuance, receipts). Wired Turnstile validate.
- EIP-712 binds full immutable identity: factory, Factory version, creator, quote, mode, ticker, name, metadata hash, virtualQuote0, curve, authId, deadline, chain. Metadata frozen at launch.
- `permanentlyLockTicker` requires a REACTOR-native authorized-factory token with matching ticker. Reserved names are separate (`reserveTicker`).
- Quote simulates exact RouteGraph edges (`OFFICIAL_REACTOR_V4` / `EXTERNAL_V4_HOOKLESS` / `BONDING_CURVE`). Multi-candidate ≤3 hops. Sim fail → unavailable. Never `minOut` 0/1.
- Indexer: rich `OfficialPoolCreated` UPSERT, real 24h aggregations, Arc finality confirmation depth.
- Keeper: single lease leadership (not mixed with advisory lock). No silent static ZEC in prod. R2/S3 fail-closed in prod.
- Factory V1 EIP-170 split: `InstantLaunchModule` (no proxy) creates tokens, verifies EIP-712, opens official fair pools. Factory runtime 23,280 ≤ 23,552 CI gate.
- Docs corpus: How REACTOR Works, trust top-10, Guardian/Keeper matrix, admission, routes, examples. Protocol **0.2.0**.
- UI: `/search`, ticker+challenge launch path, Lightweight Charts, tape, contextual docs, private Ops.

### Tokenomics

- No change. Different split = new Factory version, not an edit to V1.

### Known limits (honest)

- Not audited. No public mainnet. Arc Public Testnet deploy of Factory is attempted and recorded in `BUILD_REPORT.md` — do not claim success without an explorer tx.
- Top-10 ranks remain an offchain API (trust assumption #1).
- Factory V1 is split: `InstantLaunchModule` holds `new ReactorToken`, EIP-712 verify, and official-pool open. Runtime is under EIP-170 with a 1,024-byte CI margin (`pnpm size:guard`). Arc Public Testnet create is attempted and recorded — do not claim success without an explorer tx.

## [0.1.0] - 2026-09-11

First explicit protocol semver. Pre-audit. **Local Anvil / testnet docs only. Not mainnet.**  
Git tag: `v0.1.0`. Factory: **V1** (`FACTORY_VERSION = 1`).
