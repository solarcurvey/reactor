# FAQ

> Protocol **{{protocolVersion}}**. Factory **{{factoryVersionLabel}}**. Not audited. No public mainnet.

**Is this audited?** No. Do not claim it is.

**Mainnet?** Blocked. Chain 5042 is disabled in Keeper and deploy scripts. Do not invent mainnet addresses.

**Is Factory V1 the protocol version?** No. Protocol is semver (`{{protocolVersion}}` in `docs/version.json`). Factory **{{factoryVersionLabel}} stays {{factoryVersionLabel}} forever**. A different 3.5% split is Factory V2.

**Why did a page say it broke?** App and route error boundaries catch render failures. Other routes keep working. Release SHA and a `ref {traceId} · chain {chainId}` line are on the screen for operators. See [Observability](/docs/observability).

**Do you send my wallet seed to Sentry?** No. Telemetry redacts keys, mnemonics, signatures, Turnstile tokens, and cookies. 32-byte hex is truncated. The BFF drops residual secrets. DSN is optional.

**What is frozen?** Official LP fee **0%**, protocol charge **3.5%** (**2% holders / 1% / 0.5%**), launch supply **1B / 18**, Dev Buy cap **5%**, ticker lock **24h**, Instant 79.31 / 20.69, CORE 100M vest + 900M locked. Creators have no supply/FDV/fee knobs.

**Why do I see Turnstile?** Admission. CHALLENGE is not a signature. Solve it and retry. ELEVATED/ATTACK can ALLOW after a real token if you are under limits.

**Why did Fair launch revert WrongParams?** The signature must hash the resolved supply/decimals/duration/auctionBps/minRaise. Instant still uses `INSTANT_CURVE_V1`. `FAIR_V1` is an identifier only.

**Why is EURC not $1?** Only `usdPegOne` assets are. Guardian sets that flag. Category.Stablecoins is not $1.

**Why is the board an error instead of empty?** The indexer is down. Empty means `GET /markets` returned zero rows (`?inject=empty` in the QA build). Review can force the outage banner with `?inject=indexer` ([UI QA](/docs/qa)).

**Why is my route unavailable?** Preview failed or `amountOut`/`minOut` is dust. The API will not ship minOut 0/1. A SELL preview that cannot produce first-leg quoteOut is also unavailable — the API will not invent `minQuoteOut` from your token size. The ticket shows “Quote unavailable” (review: `?inject=quote`).

**Why does a sell have two mins?** `minQuoteOut` is the least quote you accept from the official/bonding first leg. `minOut` is the least USDC (or same quote, if you sell direct) you accept at the end. Different units.

**Why is my token image missing?** The UI only renders first-party `/m/<id>.webp` (or `/icons/`). `javascript:`, `data:`, and random `https://` hosts are dropped. Initials show instead.

**Why did admission DENY my name?** HTML tags and dangerous URL schemes in identity fields are hard-denied. That is not a Turnstile CHALLENGE.

**Why is Confirm / Launch disabled on the wrong chain?** The launchpad hard-blocks wallet writes when `wallet.chainId` is not the official deployment. The red banner is not the only control.

**Why did launch / quote / upload return 403 or 503 with `DENY_*` / `UNAVAILABLE_*`?** REACTOR-operated write and authorization paths enforce a server-side sanctions/geo policy (recovered wallet proof + trusted geo). Client “clear” flags and claimed `wallet` / `x-reactor-wallet` values do not override it. `GET /operator-policy/status` returns the same minimized decision for the launchpad UX. Public `GET /markets` and docs stay readable. Onchain contracts are not paused. See [Operator policy](/docs/operator-policy).

**Why is Confirm / Launch disabled with “Unavailable”?** REACTOR-operated services refused this request, account, or location — or required access checks are temporarily down. Temporary includes a missing or older-than-7-day official-list snapshot (#64). The UI does not accuse anyone of unlawful conduct. Public markets and docs stay readable. Onchain contracts are not paused. See [Restricted access](/docs/restricted-access) and [Sanctions ops](/docs/sanctions-ops).

**Why is script-src nonce'd?** Production CSP does not allow `'unsafe-inline'` scripts. A leftover `'unsafe-inline'` remains on `style-src` only (React / fonts / Tailwind). See [Browser security](/docs/web-security).

**Does the launchpad geo-block from the browser?** No. Jurisdiction policy is a **server** ALLOW / DENY / UNKNOWN evaluator over trusted edge metadata. The UI does not ship a country list. HTTP write enforcement is [operator policy](/docs/operator-policy). This is not a legal opinion and is not a claim of sanctions compliance. See [Geo policy](/docs/geo-policy).

**Why did Arc ignore 8 confirmations?** Arc BFT is final on commit. Default lag is 0.

**Why can't I buy when the curve says ready?** Instant is frozen until `graduate`. No buys or sells in that window.

**Where does the 2% go if I am the first buyer?** SelfBurn. Rewards `eligibleSupply==0` is not a first-holder rebate.

**Does CORE rank in Top-10?** No. Never. Official CORE book is 2.5% burn + 1% flywheel.

**Are Top-10 ranks trustless?** No. Offchain API (`GET /top10`, schema v11). Contracts check structure only. The web app proxies the indexer snapshot; it does not walk Factory logs.

**When do the bottom-right burn toasts show?** Only after the indexer commits a CORE buy+burn (`BuybackExecuted` / `COREBurned`) or a Top-10 `Top10Buy`. Connecting does not dump the SSE replay buffer. A reconnect still delivers events that landed while you were disconnected, exactly once. Epoch submit and Standard SelfBurn do not toast. Hover or focus pauses auto-dismiss.

**Where is the Safe JSON?** `deployments/safe-genesis-builder.json`. Deployer ≠ Guardian. Fill env and regenerate (`pnpm safe:genesis`).

**Can I change the 3.5% split?** No. Different split = V2 factory deploy.

**Are you OFAC compliant?** No such claim. `GET /sanctions/screen` is exact official-list address matching only (Treasury/OFAC XML) — not hop / cluster / exposure analytics. `unavailable` is not `clear`. Operated write assistance is gated by [operator policy](/docs/operator-policy) using that lookup, trusted geo, and the 7-day freshness SLA. Public contracts remain callable onchain. See [Address screening](/docs/sanctions), [Sanctions ops](/docs/sanctions-ops), and [Restricted access](/docs/restricted-access).

**Is this repository public?** Not unless the founder flips visibility. Do not publicize without that instruction. The operator checklist is [Repo publicization](/docs/publicization) (Refs #72). Personal-mailbox trailers were remapped to GitHub noreply on advertised refs; residual GitHub dangling objects are accepted. Agents must not flip visibility.

**Is the brand locked?** Visual direction yes — **Industrial Forge** (Direction C), founder-approved. Canonical tokens and assets are in [Brand](/docs/brand). Issue [#55](https://github.com/solarcurvey/reactor/issues/55) stays open until independent audit of the production surfaces. Not a protocol change.

**What does CI run?** Fast PR: `pnpm test:lib` (indexer + web unit + `docs:check` + `docs:links` + cheap security). Full merge-candidate / main: that plus Foundry (`FOUNDRY_PROFILE=ci`, Attack suite, CREATE2, size guard), production Next security, live-toasts, Postgres, Playwright smoke + interactive, and #35 `e2e-release-gate`. See [CI and cost](/docs/ci).

**Why didn't the full CI suite run?** Draft feature-branch updates and **docs-only / trivial** PRs (even ready-for-review) run the fast gate only (`pnpm test:lib`, plus targeted Foundry if Solidity changed). A non-draft **code** PR, the `ci-full` label, or `workflow_dispatch` tier **full** runs the heavy matrix. See [CI and cost](/docs/ci).

**Why did an old CI run cancel?** A newer force-push on the same PR cancels in-progress jobs. Main post-merge runs are keyed by SHA and are not canceled by unrelated PRs.

**Why was my launch or quote refused with a compliance-unavailable error?** REACTOR-operated writes fail closed when the official-list snapshot is missing or older than the 7-day SLA, or when operated write assistance is emergency-disabled. That is not an onchain revert. See [Sanctions ops](/docs/sanctions-ops). A complaint does not auto-clear a deny.

**Where is the sanctions runbook?** [Sanctions runbook](/docs/sanctions-runbook), linked from [Incident response](/docs/incident-response).

**Is REACTOR live on Arc Public Testnet?** #16 rehearsal recorded Factory `0xB48D1B397834eBcccb8961041d827487097e0535`, Instant + Fair smoke, and a LOCAL authorize Instant RHRSL + Fair RHRFL path on [testnet.arcscan.app](https://testnet.arcscan.app). Addresses: `docs/deployments.md`. Quote is Mock USDC-6, not canonical `0x3600…0000`. Guardian is a disposable EOA, not a Safe. LOCAL authorize is not full PROD. `claimedProdPath` in `deployments/arc-testnet-prod-path.json` stays false until Turnstile + isolated signer ≠ deployer ≠ Keeper + a real wallet are present. Not audited. No mainnet. Keep #16 open for human AC.

See [Troubleshooting](/docs/troubleshooting), [Glossary](/docs/glossary), [Trust](/docs/trust), [Observability](/docs/observability), [CI and cost](/docs/ci).
