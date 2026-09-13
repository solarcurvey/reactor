# Glossary

> Protocol **{{protocolVersion}}**. Factory **{{factoryVersionLabel}}**. Terms used in this handbook.

| Term | Meaning |
| --- | --- |
| Official REACTOR Pool | Hooked Uniswap v4 pool, **0% LP**, 3.5% quote-side hook charge |
| Instant | Bonding curve → ready → frozen → graduate → locked v4 |
| Fair | Pro-rata timed sale, 0% during auction, 50/50 locked at clear |
| `INSTANT_CURVE_V1` | Instant `curveConfig` constant |
| `fairCurveConfig` | `keccak256(abi.encode(supply, decimals, duration, auctionBps, minRaise))` |
| `FAIR_V1` | Identifier only — not a valid Fair `curveConfig` |
| `launchConfigHash` | ALLOW-receipt digest of immutable launch identity |
| Turnstile | Cloudflare widget + `siteverify`. CHALLENGE ≠ ALLOW |
| Issuance bucket | Durable cap on **signed** LaunchAuthorizations |
| ValuationService | Single USD engine for signer, Top-10, `/markets` |
| Top-10 snapshot | Indexer `GET /top10` (schema v11). Served only while `computedTs` is within 15 minutes. Not a per-request Factory RPC. |
| Burn-adjusted supply | Remaining onchain `totalSupply` after any `burn()`. Indexer `current_supply` (schema v9) tracks it via token-level burns (same tick transaction as the cursor) + bounded `totalSupply()` reconcile — not a live ≡ and not a protocol-event sum |
| `fdv_usd6` | USD-6 market cap / FDV = mark × burn-adjusted remaining supply. Not initial 1B × price |
| `usdPegOne` | Explicit $1 flag. EURC / “stable” is not $1 |
| UserRouteQuoter | Whole-route `eth_call` preview; always reverts `PreviewRoute` |
| UserRouteExecutor | User nested USDC path. Not a vault |
| `feeLegs[]` | Official 3.5% hops on the scored user winner |
| `exemptOfficialLegs[]` | Official edges on a fee-exempt Keeper/protocol ticket |
| `aggregateProtocolImpactBps` | Compound official impact (two 3.5% hops → **688**) |
| `minQuoteOut` | SELL first-leg quote floor (quote units, not tokenIn) |
| `minOut` / `minFinalOut` | Final output floor (USDC on a nested SELL) |
| Guardian | Only privileged security authority |
| Keeper | `AutomationGateway`. Relayers deliver signed jobs. One atomic lease (renew + fence) |
| Job signer | Offchain key that signs `MaintenanceJob`. Not the relayer |
| Relayer | CRE / Gelato / any EOA that submits a signed job |
| CORE | Protocol token (`CoreToken`). Never Top-10. Genesis 100M vest + 900M locked |
| Factory V1 | Immutable on-chain factory label. Not protocol semver |
| Protocol {{protocolVersion}} | This software + docs release |
| Fast / full / main CI | Three-tier GitHub Actions ([CI and cost](/docs/ci)). Fast = PR units + `docs:check` + `docs:links`. Full = merge-candidate + production Next / Foundry / Postgres / Playwright smoke / `obs-ui` / #35 `e2e-release-gate`. Main = one post-merge SHA |
| Repo publicization | Operator checklist to maybe make the GitHub repo public later. Not mainnet readiness. Do not flip visibility without founder instruction. AC1 is advertised refs only; Support purge/GC is an accepted residual. |
| Millisecond columns | `Date.now()` wall clock: admission hits, issuance `updated_ms`, leader lease, Keeper jobs, alerts. Postgres `BIGINT` (schema v6) |
| Unix-seconds columns | `Date.now()/1000` or `block.timestamp`: trades, ticker lock, receipt expiry |
| Arc gas USDC | Native 18-decimal gas unit |
| Protocol USDC | ERC-20 6 decimals (`0x3600…0000` on Arc) |
| Ready / frozen | Instant terminal state: no buy/sell until `graduate` |
| SelfBurn | 2% destination when Standard, or Rewards `eligibleSupply==0` |
| THE REACTOR | 1% Top-10 flywheel UI (`/reactor`) |

See [FAQ](/docs/faq), [Economics](/docs/economics), [Trust](/docs/trust).
