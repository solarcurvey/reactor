# TESTING

## Commands

```bash
cd contracts
export PATH="$PATH:$HOME/.foundry/bin"

forge test -vv
forge test --fuzz-runs 256
forge test --match-path test/invariant/RewardCampaign.t.sol -vv
# Do not treat test/unit/FeeInvariant.t.sol or test/invariant/Rewards.t.sol as stateful invariants.
forge test --match-path test/attack/* -vv
forge test --match-path test/integration/* -vv
```

Web ranker / market-data / keeper / valuation / indexer schema (no RPC):

```bash
pnpm --filter indexer test
# tick-atomic.test.ts: SQLite always; Postgres when DATABASE_URL or compose :54329 is up (REQUIRE_PG=1 to fail if missing)
# two Keeper workers on real Postgres (CI job keeper-lease-pg; docker compose postgres :54329)
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg-lease
npx --yes tsx apps/web/src/lib/top10.test.ts
npx --yes tsx apps/web/src/lib/marketdata.test.ts
pnpm docs:check                 # fees / supply / Dev Buy / ticker lock / factory / protocol version / deployments
pnpm --filter web test          # Playwright smoke + interactive
# Real Postgres (docker compose postgres on :54329, or local 5432)
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke
# CI: .github/workflows/docs-sync.yml job postgres-ms-timestamps (includes test:pg-lease)
```

`pnpm docs:check` (and `.github/workflows/docs-sync.yml`) **must fail** when generated constants, `docs/version.json`, Factory labels, or deployment tables have drifted from Solidity/config. Do not edit generated `docs/versioning.md` / `docs/deployments.md` / `docs/changelog.md` by hand — run `pnpm docs:gen`.

Authoritative current-architecture walk (Foundry, no live chain):

```bash
forge test --match-path test/integration/CurrentArchitecture.t.sol -vv
```

Live Anvil probe (needs deploy): `pnpm --filter indexer e2e`

Static analysis (optional, when slither is installed):

```bash
slither contracts/src --exclude-dependencies || true
```

## §39 Regression list

Every row is implemented in-repo. Re-run the matching file after any curve / fee / vault / routing change.

| # | Requirement | File / test |
| --- | --- | --- |
| 39.01 | Ready freeze: buy after ready reverts | `test/attack/CurveFreeze.t.sol` |
| 39.02 | Ready freeze: sell after ready reverts | same |
| 39.03 | Terminal buy → exact ready → graduate | same |
| 39.04 | One-before-terminal then fill | same |
| 39.05 | Exact terminal | same |
| 39.06 | Oversized terminal: clip + refund unexecuted + unearned fee | same + `Curve.t.sol` |
| 39.07 | Repeat graduate reverts | `CurveFreeze.t.sol` |
| 39.08 | Sell before ready succeeds; after ready reverts | same |
| 39.09 | Graduate revalidates reserves; no stranded inventory | same |
| 39.10 | SelfBurn `minTargetOut==0` reverts | `KeeperMinOut.t.sol` |
| 39.11 | Top-10 final `minTargetOut==0` reverts | same |
| 39.12 | CORE `minOut==0` reverts | same |
| 39.13 | Sandwich quote→exec reverts | same |
| 39.14 | No hardcoded maintenance `minOut=1` on vault execute | same (Keeper supplies) |
| 39.15 | `bindFactory` attacker frontrun | `FrontrunBind.t.sol` |
| 39.16 | Hook / vault / flywheel / registry / router binds | same |
| 39.17 | No Ownable / bootstrap residue | same |
| 39.18 | Privileged surface Guardian or Keeper only | `GuardianP0.t.sol`, `PRIVILEGE_MAP.md` |
| 39.19 | Signed launch auth: USDC requires EIP-712 | `LaunchAuthorization.t.sol`, `LaunchPricing.t.sol` |
| 94 | Ticker normalize / reserve / 24h lock / no squat | `TickerRegistry.t.sol` |
| 95 | LaunchAuthorization replay / ticker / factory / fair | `LaunchAuthorization.t.sol` |
| 96 | Factory version persist + deprecate new-only | `TickerRegistry.t.sol` |
| 97 | Permanent lock one-way | `TickerRegistry.t.sol` |
| 39.20 | Non-$1 without sig reverts | same |
| 39.21 | Expired / replay / wrong factory / quote / decimals / tampered / zero / chain | same |
| 39.22 | Old signer after rotation; Keeper rotate ≠ signer rotate | same |
| 39.23 | Unique digest replay / concurrent same-quote / quarantine (no serial nonce) | same |
| 39.43 | Signed `virtualQuote0` initializes the curve; USDC/ZEC/WBTC/native same USD geometry | `LaunchPricing.t.sol` |
| 39.44 | ProtocolV4Adapter nested settle creates zero new 2/1/0.5; user trade pays 3.5% | `ProtocolSettlement.t.sol` |
| 39.45 | UserRoute USDC path while bonding | `UserRoute.t.sol` |
| 39.46 | No `setHook`; hookless + official only | `GuardianP0.t.sol`, `RoutingDeltas.t.sol` |
| 39.47 | CORE ticks + vest + burn + Top-10 exclude | `CoreLiquiditySim.t.sol` |
| 39.24 | Rewards genesis `eligible==0` → SelfBurn | `Token.t.sol`, `Curve.t.sol` |
| 39.25 | Hop real in/out deltas | `RoutingDeltas.t.sol` |
| 39.26 | Lying adapter fails | same |
| 39.27 | Arbitrary v4 hook denied | same |
| 39.28 | Max 3 hops | same |
| 39.29 | No cycles | same |
| 39.30 | Flywheel / SelfBurn / CORE chunk + cooldown | `BlastRadius.t.sol`, vaults |
| 39.31 | CORE `burn()` only (no dead-address) | `BuybackVault._burn`, `Top10E2E.t.sol` |
| 28.xx | CORE genesis 35 cases | `test/unit/CoreGenesis.t.sol` |
| 29.xx | CORE stateful invariants | `test/invariant/CoreInvariant.t.sol` |
| 39.32 | UserRoute `minQuoteOut` + `minFinalOut` + deadline; sandwich reverts; not a vault | `UserRoute.t.sol` |
| 39.32b | Quote API SELL `minQuoteOut` from `splitPreviewRoute` terminal (6/8/18, bonding/graduated/nested); calldata matches; preview fail → no ticket | `quote-sell-floors.test.ts` |
| 39.33 | Top-10 structural: no CORE, no dupes, ≤10, weights 100% | `Top10Security.t.sol`, `Top10Api.t.sol` |
| 39.34 | Fee 3.5% → 2/1/0.5 | `FeeInvariant.t.sol` |
| 39.35 | No transfer tax | `Token.t.sol` |
| 39.36 | Reward solvency / leftover | `RewardSolvency.t.sol` |
| 39.37 | Liquidity lock | `LockAndBuyback.t.sol` |
| 39.38 | Fair 0% during sale; finalize once | `Launches.t.sol` |
| 39.39 | Cross-quote flush | `CrossQuoteFlush.t.sol` |
| 39.40 | CREATE2 hook bits | unit hook |
| 39.41 | FoT quote / reentrancy / sandwich docs | `Security.t.sol`, `Attacks.t.sol` |
| 39.42 | Guardian P0 routing/vault/Keeper (40 cases) | `GuardianP0.t.sol` |

## §40 Stateful invariants

| Suite | Command | Bound |
| --- | --- | --- |
| Reward campaign (magnified DPS, leftover, debt) | `forge test --match-path test/invariant/RewardCampaign.t.sol` | default 64 runs / 2048 calls; `outstanding <= backing` **no slack** |
| Reward solvency (legacy vs magnified) | `test/invariant/RewardSolvency.t.sol` | unit + invariant |
| Fee fuzz / flush fuzz | `test/fuzz/FeeFuzz.t.sol`, `FlushFuzz.t.sol` | dust / overflow |

**Do not** treat `FeeInvariant.t.sol` or `test/invariant/Rewards.t.sol` as the stateful campaign. Campaign asserts `outstanding <= backing` with no slack. See `HARDENING_REPORT.md`.

Not claimed as a proof: routing graph, nested USD marks, or Keeper liveness.

## §41 E2E

```bash
# Local chain must be running + deployed
pnpm --filter indexer demo   # viem + Anvil; writes deployments/e2e-evidence.json
```

Optional Foundry sketch: `contracts/script/DemoE2E.s.sol`.

UI capture (after `pnpm --filter web dev`):

```bash
CAPTURE=1 CAPTURE_URL=http://127.0.0.1:43147 pnpm --filter web test
```

Writes `review/*-1440.png` and `review/*-390.png` for home, compact Instant, fair, trade, rewards, THE REACTOR, CORE, quote ecosystems, wallet. **No creator FDV slider.**

Keeper / watchdog (do not treat as onchain):

```bash
pnpm --filter indexer keeper
pnpm --filter indexer watchdog
```

## Required suites (legacy map)

| Area | File |
| --- | --- |
| Guardian / Keeper / routing P0 §42 | `test/unit/GuardianP0.t.sol` |
| Top-10 API §43 | `test/unit/Top10Api.t.sol` |
| Top-10 / Keeper security | `test/attack/Top10Security.t.sol` |
| Top-10 + CORE E2E burns | `test/integration/Top10E2E.t.sol` |
| Curve freeze | `test/attack/CurveFreeze.t.sol` |
| Keeper minOut | `test/attack/KeeperMinOut.t.sol` |
| Frontrun binds | `test/attack/FrontrunBind.t.sol` |
| Launch pricing | `test/attack/LaunchPricing.t.sol` |
| Routing deltas / hooks | `test/attack/RoutingDeltas.t.sol` |
| Nested hop floors | `test/attack/HopFloors.t.sol` |

## Final-pass regressions (user list)

| # | Requirement | Proof |
| --- | --- | --- |
| 1 | Vault execute returns burned/core/target/usdc | `KeeperReturns.t.sol` |
| 2 | Keeper minOut > dust | `keeper.minout.test.ts`, `KeeperMinOut.t.sol` |
| 3 | Low sim blocks tx | `conservativeMinOut` throws ≤1 |
| 4 | Dynamic quote buckets | `keeper.ts` `discoverQuotes` |
| 5 | Nested settle + nested Top-10 fee-exempt | `ProtocolSettlement.t.sol` |
| 6 | Historical swap timestamps | `indexer.persist.test.ts` |
| 7 | Indexer restart pool maps | same |
| 7b | Event writes + cursor atomic (including token burn journal); canonical `(chain_id, tx, log_index, event_kind)` (SQLite + Postgres) | `tick-atomic.test.ts`, `pg-smoke.ts` |
| 8 | Inactive low-value does not freeze | `Top10Api.t.sol` thousands inactive |
| 9 | Material candidate freezes | same |
| 10 | External spot does not control mark | VWAP window + `fuseExternalUsd6` |
| 11 | Nested ValuationEngine + cycle reject | `valuation.test.ts` |
| 12 | EURC not $1 | `LaunchPricing.t.sol` |
| 13 | USDC still requires LaunchAuthorization | `LaunchAuthorization.t.sol` §95 |
| 14 | Concurrent auths + no replay | `LaunchPricing.t.sol` |
| 15 | Bonding nested USDC buy/sell | `UserRoute.t.sol` |
| 16 | Keeper LOCAL + ARC_TESTNET | `keeper.ts` modes; 5042 disabled |
| 17 | No double-exec on ambiguous RPC | `submitOnce` |
| 18 | Protocol-exempt reentrancy blocked | `ProtocolExemptReentrancy.t.sol` |
| 19 | Safe genesis payload | `SafeGenesis.t.sol`, `VerifyGenesis.s.sol` |
| 20 | Deployer no post-genesis privilege | same |
| 21 | Nested hop floors from per-hop sim, not last-leg/dust | `HopFloors.t.sol`, `stampHopMinOuts`, `applyMinOuts` |
| 22 | Public buyPrefunded drain deleted; router-only pull | `BuyPrefundedDrain.t.sol` |
| 23 | Keeper executes frozen onchain epoch, not latest API | `frozenEpochTargets` in `keeper.minout.test.ts` |
| 24 | lastGoodFdvQuote accepts 3 historical samples | `marketdata.test.ts` |
| 25 | CAT/ZCAT nested e2e (not CAT/USDC) | `CurrentArchitecture.t.sol` |
| 94 | Ticker normalize + 24h lock + no squat | `TickerRegistry.t.sol` |
| 95 | LaunchAuthorization every launch, unique authId | `LaunchAuthorization.t.sol` |
| 96 | Factory version persist; deprecate new-only | `TickerRegistry.t.sol` |
| 97 | Permanent lock one-way, not an oracle | `TickerRegistry.t.sol` |
| 80 | P0 admission: signer bypass fails; CHALLENGE ≠ ALLOW; durable throttle | `admission.test.ts` |
| 80 | P0 EIP-712 full identity + frozen metadata + hardened lock | `LaunchAuthorization.t.sol`, `TickerRegistry.t.sol` |
| 80 | P0 quote exact RouteGraph edges; never minOut 0/1 | `routes.test.ts`, `quote-service.ts` |
| 80 | P0 Factory EIP-170 sizes + Arc attempt | `scripts/size-guard.ts`, `deployments/arc-factory-attempt.json` |
| 26 | Turnstile widget + ELEVATED/ATTACK ALLOW after challenge | `admission-unit.test.ts`, `admission.test.ts` |
| 27 | launchConfigHash + atomic receipt consume | `admission.test.ts` |
| 36 | Pricing signer fail-closed without durable store (no skip consume / bucket) | `pricing-signer-store.test.ts` |
| 28 | Fair curveConfig binds sale params | `FairCurveConfig.t.sol` |
| 29 | permanentlyLockTicker vs other token 24h lock | `TickerRegistry.t.sol` |
| 30 | 24h NUMERIC / latest-by-ts / ValuationService USD | `ingest.ts`, `valuation.test.ts` |
| 30b | `fdv_usd6` tracks remaining `totalSupply()` (holder burn, protocol-only would stay stale, identity + reconcile, CORE). Schema v9 from a real post-#27 (v8) DB | `ingest.valuation.test.ts`, `schema.test.ts` |
| 30c | Token burn journal + cursor are one transaction; crash on `indexer_state` cannot skip `Burned`/`Transfer` rows on restart (SQLite + Postgres) | `tick-atomic.test.ts` `runBurnCursorAtomicSuite`, `pg-smoke.ts` |
| 31 | UserRouteQuoter one eth_call; never minOut 0/1 | `quote-service.ts`, `UserRouteQuoter.sol` |
| 32 | Nested quote without intermediate wallet balances | `UserRoute.t.sol` `test_nested_preview_without_intermediate_wallet_balances`, `quote-overrides.test.ts` |
| 33 | Production hard gates (Turnstile + no Anvil/inline signer) | `prod-gates.test.ts` |
| 34 | Safe Builder JSON from local artifacts; deployer ≠ Safe | `scripts/safe-genesis-builder.test.ts` |
| 35 | sharp required (not optional) | `sharp-check.test.ts` |
| 36 | Postgres millisecond columns are BIGINT; Date.now() persists; v5 migrates | `pg-ms-timestamps.test.ts` (`pnpm --filter indexer test:pg`) |
| 37 | R2/S3 object key equals public `/m/<id>.webp`; mock GET returns the object; PROD upload failure returns no StoredMedia | `media-r2.test.ts` |
| 38 | Indexer event writes + cursor atomic; log identity `(chain_id, tx, log_index, event_kind)` (schema v8 journal); token burns in the same tick transaction | `tick-atomic.test.ts` (SQLite + Postgres), `pg-smoke.ts` |
| 39 | Selected route + atomic preview/minOuts/terminal from the same candidate; PreviewRoute is hops+1 (BUY append / SELL prepend) | `quote-integrity.test.ts`, `quote-select.ts`, `UserRoute.t.sol` `test_nested_previewSell_hops_plus_terminal` |
| 40 | Keeper lease renew + fence: long tick cannot overlap; stale fence cannot send | `keeper.lease.test.ts` |
| 41 | Two Postgres workers: one winner, renew vs overlap, expiry/crash takeover, stale fence cannot send | `keeper.lease.pg.test.ts` (`test:pg-lease`, CI `keeper-lease-pg`) |
| 42 | Markets keyset cursor matches `sort` (`new`/`vol`/`price`); insert-ahead no dupes | `markets-query.test.ts` |
| 43 | Candle gap-fill bounded; exclusive aligned `before` | `packages/reactor/src/prices.test.ts` |
| 44 | Public JSON POSTs reject oversized / chunked bodies (413); env cannot raise past 64KiB hard max | `read-json-body.test.ts`, `limited-json.test.ts` |
| 45 | Routed SELL `minQuoteOut` is first-leg quoteOut from `splitPreviewRoute` | `quote-sell-floors.test.ts`, `sell-floors.ts` |
| 46 | Nested official fee legs from scored winner + compound 688 bps; maintenance `exemptOfficialLegs[]` | `quote.test.ts`, `quote-api.test.ts`, `quote-integrity.test.ts` |
| 47 | Trade ticket does not sum nested fee amounts across quote tokens/decimals (ZEC-8 vs ZCAT-18) | `apps/web/src/lib/fee-legs.test.ts` |

## Arc smoke

`test/integration/ArcSmoke.t.sol` runs against the local Arc-compatible chain id and 6-decimal quote. A live RPC smoke (`--rpc-url $ARC_TESTNET_RPC`) is opt-in and must not be required for CI.
