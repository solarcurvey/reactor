# THREAT MODEL

Hostile-reader notes for Codex / external review. **Not an audit.**

## Assets

- Official pool reserves (in `PoolManager`)
- Locked v4 positions (owned by `ReactorLiquidityVault`)
- Holder reward quote (in each `ReactorToken`)
- Buyback quote reserve and TestCORE
- Quote allowlist integrity
- Hook permission bits / CREATE2 identity

## Actors

| Actor | Intent |
| --- | --- |
| Honest trader / launcher / bidder | Use the product |
| MEV searcher | Sandwich, JIT, backrun buyback |
| Malicious creator | Reclaim LP, hidden mint, tax, exclude holders |
| Malicious hook caller | Charge unofficial pools, steal deltas |
| Malicious quote | Fee-on-transfer, rebase, 6-vs-18 confusion |
| Compromised Guardian | Halt launches/trading/Keeper; quarantine quotes; disable adapters. Cannot withdraw LP or redirect pots. |
| Compromised Keeper | Waste a pot on a bad route/`minOut` within hop/bucket bounds. Cannot config, withdraw, or change fees. |
| Overlapping Keepers | Two daemons both believing they are leader after a ~50s lease expires mid-tick. Mitigated by renew + fence; residual TOCTOU between last renew and RPC send. |
| Compromised registry admin | Retired — quotes are Guardian (external) or factory-native. |
| PoolManager (Uniswap) | Trusted v4 singleton; BUSL; not our code |

## Controls

1. **No owner mint / pause / blacklist / tax** on `ReactorToken`.
2. **No LP withdraw** on the vault.
3. **Hook only charges `officialPool`.** Initialize gated to factory + 0% fee + registered quote.
4. **Fee always quote** via specified/unspecified split (ADR-006).
5. **Rewards O(1)**; debt synced on every transfer; excluded set immutable.
6. **Buyback CORE target immutable**; designated Keeper routes via approved adapters (≤3 hops); tokenIn from bucket; recipient is the vault then burn; cooldown / chunk; reentrancy guard. Vault execute **returns** burned/core/target/usdc — Keeper must consume the sim result (never invent minOut).
13. **`protocolExempt` latch** is router-scoped and `nonReentrant`. User `swap` is forbidden while the latch is set. Malicious FoT callback cannot sneak a fee-free user trade (`ProtocolExemptReentrancy.t.sol`).
14. **usdPegOne-only $1**. Guardian must set the peg flag. EURC is not $1.
15. **Launch auth digest** is unique (no serial nonce griefing). Replay is `TickerRegistry.usedAuthorization[digest]`. Isolated signer **fail-closes** if the durable store is unavailable — it must not skip receipt consume or the signed-auth issuance bucket.
16. **External USD marks** are offchain multi-source consensus (`fuseExternalUsd6`). Stale/outlier/deviating prints are persisted and rejected. PROD never falls back to a static dollar. A single HTTP outage or a two-source disagreement disables new launches on that quote and pauses a material Top-10 candidate. Not an onchain oracle.
7. **Batch Fair finalize once**; `FairClaimVault` eligible; auction has no hook.
10. **Canonical flush** — quote derived from `marketOfToken`; two-arg flush reverts on mismatch.
11. **Exact-in + nonzero minOut + incomplete-fill revert** on the router.
12. **Binds are Guardian-only + freeze**, not first-caller-wins and not Ownable/bootstrap.
8. **Guardian cannot** withdraw, mint, change fee BPS, set Top-10, or take fee exemption as a wallet. See `GUARDIAN_MODEL.md`.
9. **FoT / rebase quotes:** `creditRewards` / vault `accrue` measure actual received; shortfall reverts. Rebasing quotes are unsupported (document + do not register).
16. **Keeper lease fence** — one `leader_locks` row; live leader renews `lease_until` without changing acquire `ts`; send is refused if renew fails. See `KEEPER_MODEL.md` and `/docs/keeper`.

## Offchain indexer (not custody)

Postgres is the production store. SQLite is local-only and uses 64-bit INTEGER, so it will not catch 32-bit overflow. Columns that receive `Date.now()` milliseconds (`admission_hits.ts`, `issuance_bucket.updated_ms`, `leader_locks.ts` / `lease_until`, `keeper_operations.ts`, `alerts.ts`) must be `BIGINT`. A 32-bit INTEGER overflows (~1.8e12 vs max 2_147_483_647) and fails closed on admission throttle, Keeper leadership, jobs, and alerts. Unix-seconds fields (trades, ticker lock, receipt expiry) are a different convention — do not mix units. Schema v6. See `ARCHITECTURE.md`.

## Residual risks (highest first)

1. **Hook custom accounting** — wrong sign on `BeforeSwapDelta` / afterSwap unspecified delta can steal from swappers or insolvent the hook. V1 tests cover exact-in buy/sell × token0/token1 (exact-out disabled).
2. **Reward solvency** — Magnified DPS + corrections. Leftover magnified remainder is unassigned carry-forward (never double-allocated). Campaign asserts `outstanding <= backing` with no slack. Last claimer can still be short unassigned dust. Credit is booked before ERC-20 lands. **Not production-invariant-complete.**
3. **CREATE2 hook bits** — a mis-mined address silently skips callbacks (0% charged) or enables extra callbacks.
4. **Single-sided launch price** — extreme FDV vs 1e9 supply can clamp to TickMath edges and look “wrong” versus the UI valuation.
5. **Buyback sandwich** — permissionless `execute(quote)`; caller cannot set size or minOut. Reference is last-good spot, not a multi-block TWAP. First observation can be manipulated if the CORE pool is thin. Failure no-ops.
6. **Registry admin lists FoT/rebase quote** — operational, not a custody risk.
7. **v4-core BUSL / unaudited REACTOR** — legal + quality. No audit claim.
8. **Arc dual-decimal USDC** — mixing `address.balance` (18) with `USDC.balanceOf` (6) by 1e12. Contracts use the ERC-20 interface only.
9. **Arc value-transfer rules** — native send to `address(0)` reverts; blocklisted index-1 test address reverts. Vaults never burn native USDC to zero.
10. **Flash / sandwich / JIT** on official pools — accepted AMM risk; 0% LP fee reduces JIT incentive.
11. **Keeper split-brain** — a tick can outlive the ~50s lease (receipt wait 60s; large discovery). Without renew, a standby can acquire and both broadcast. Control: interval renew + pre-send renew of the same fence; lost lease refuses send. Residual: process pause after renew, then send. Not an on-chain fence (architecture frozen). Unit / `test:pg-lease` TTL proofs inject the lease clock; they do not change this residual.
12. **Indexer crash window** — ingest used to write events then advance the cursor after the loop. A later #8 path fetched token `Burned` / `Transfer` to zero **after** that cursor commit, so a crash skipped those journal rows on restart (`from = cursor + 1`). `persistTickBatch` now commits protocol rows, token-burn journal / `current_supply` writes, and the cursor together. Residual: post-commit 24h roll / external marks / SSE / bounded `totalSupply()` reconcile can still lag; the indexer is still not onchain truth.
13. **Stale Top-10 snapshot** — ingest `tick()` used to swallow ranker failure into an alert and leave the last healthy `current` payload. `GET /top10` now refuses snapshots older than 15 minutes and Keeper shares that TTL. Residual: the TTL is offchain policy, not an onchain freshness check.

## Public UI / browser controls

- Creator name, ticker, description, website, X, Telegram, and image are **untrusted**. The launchpad never uses `dangerouslySetInnerHTML`. Text is stripped of tags / bidi / controls before display.
- URL scheme allowlist: `https:` (loopback `http:` only). Reject `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, protocol-relative, userinfo.
- Social hosts are allowlisted (`x.com` / `twitter.com`, `t.me`). Images are first-party `/m/<id>.webp` or `/icons/…` — not arbitrary remote HTTPS (SVG XSS / tracking).
- Production security headers include CSP (`object-src 'none'`, `frame-ancestors 'none'`, tight `img-src`), COOP, nosniff, DENY frames. HSTS only when `REACTOR_ENV=PROD`.
- Admission DENYs the same payloads before EIP-712. The UI still sanitizes on read (hostile or historical onchain rows).
- Wallet `to` / recipient / calldata are resolved by `tx-guard` (official chain, official contracts, connected wallet). Creator metadata and quote-API `tx` cannot steer the write. Residual: a hostile indexer can still supply a well-formed but wrong InstantCurve **clone** address.
- Residual: phishing via a valid `https://` website that looks official; production `style-src` still includes `'unsafe-inline'` (React / `next/font` / Tailwind). Production `script-src` is nonce + `strict-dynamic` only.

## API / indexer controls

- Public JSON POSTs (`/quote`, `/launch/admit`, `/launch/authorize`) reject bodies over the JSON cap with **413** (default **16KiB**, hard max **64KiB**). `JSON_BODY_LIMIT_BYTES` cannot raise the cap past the hard max. Enforcement is on the stream: declared `Content-Length` and chunked bodies with no length. The request is destroyed at the first overflowing byte so the process cannot buffer an unbounded JSON POST.
- `POST /upload` already stream-caps at 2MB.
- The public Next BFF `/api/launch-pricing` applies the same 16KiB default / 64KiB hard max before proxying.
- Rate limits (quote / upload / pricing) are separate. Body caps + RPM are not a complete L7 DoS proof.

## Repository / GitHub Actions (not custody)

- Workflows are test-only today: `permissions: contents: read`, `actions/checkout` `persist-credentials: false`, no `pull_request_target`, no `${{ secrets.* }}`. Fork PR code must not receive repository secrets or a writable token. Compatible with #69 concurrency / staging when workflows fold into `ci.yml`.
- Residual: making the repository public publishes git history and every open draft PR. Personal-mailbox `Co-authored-by` trailers were remapped to GitHub noreply on 2026-09-12 (founder-authorized rewrite). GitHub `refs/pull/*` for closed PRs may still cache pre-rewrite objects; they are not advertised as heads. Founder accepted that residual old-SHA exposure; Support purge/GC is **not required** and is not a #72 AC. Operator checklist: `docs/publicization.md`. Agents must not flip visibility.
- Full-history gitleaks / trufflehog after the 2026-09-12 rewrite found **no live credentials** (Ethereum addresses, Anvil `#0`, dummy JWT/DSN/URL fixtures only). Re-scan immediately before any visibility change.

## Explicit non-goals

We do not prevent external pools, creator dumping after a paid buy, or social-engineering of the registry admin.
