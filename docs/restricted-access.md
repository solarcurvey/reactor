# Restricted access

> Offchain REACTOR-operated services only. Protocol **0.3.3**. Factory **V1**. Not a legal or OFAC-compliance opinion.

The public launchpad has a dedicated **`/restricted`** state when a server policy decision refuses REACTOR-operated write assistance. Copy is neutral: operated services are unavailable for this **request**, **account**, or **location**. The UI does not accuse anyone of unlawful conduct. Optional `?kind=` is applied after mount (no `useSearchParams` Suspense split) so SSR and the first client paint stay the same tree.

This is **not** an onchain pause. Immutable public contracts remain callable. The launchpad does not pretend it can censor permissionless chain reads.

Issue **#65** (child of RELEASE GATE **#60**). Server authority is **#62** (`evaluateOperatorPolicy`, merged **#68** on `main` `2002aed`), with address screening **#61** / **#66**, trusted geo **#63** / **#67**, and official-list freshness **#64** / merged **#70** (`cc82cd4`). This branch binds the launchpad to the official recovered-wallet model:

- **#61 / #66** exact official-list OFAC address matching (`GET /sanctions/screen`). Not hop / cluster / exposure analytics. Not a compliance certification. Lookup stays public; it is not itself the write gate.
- **#63 / #67** trusted geo (`evaluateRequestGeo`). Production country/region only from a verified edge HMAC. Browser `CF-IPCountry` / `X-Country` are ignored. Syria (`SY`) is not blanket-denied. Donetsk / Luhansk oblasts (`UA-14` / `UA-09`) are UNKNOWN ([OFAC FAQ 1009](https://ofac.treasury.gov/faqs/1009)), not whole-oblast DENY.
- **#62 / #68** `evaluateOperatorPolicy` on REACTOR-operated writes. Subject is the recovered EIP-191 signer. Claimed `wallet` / country / `clear` are ignored.
- **#64 / #70** 7-day official-list SLA. Stale or missing data fails operated writes (`UNAVAILABLE_DATASET_STALE`). Recovered identity only. No automated override on a user complaint.
- `GET /operator-policy/status` is the official decision read (same `evaluateOperatorPolicy` as write gates). Optional `x-reactor-wallet-proof` screens the recovered signer.
- `GET /operator-policy/challenge` issues an HMAC + EIP-191 message (`REACTOR operator-policy v1`, purpose `operator-policy-write`). It is not a decision.
- Writes (`POST /quote`, `/launch/admit`, `/launch/authorize`, `/upload`) require that recovered proof.
- Next `GET /api/operator-policy` forwards only the proof header (never a claimed wallet). The provider acquires challenge → `personal_sign` → proof header. Production `next start` fail-closes if the indexer status path is missing.

The indexer process uses official `apps/indexer/src/operator-policy.ts`. `operator-policy-bind.ts` is the #65 test/fixture adapter and delegates to that module when present.

**LOCAL** continues to allow writes when the indexer status path is missing; **production-like** environments fail closed as temporarily unavailable. LOCAL-only demo fixtures: `OPERATOR_POLICY_UX_FIXTURE`, `x-reactor-ux-fixture`, or a page `?fixture=` query (the provider forwards it to the BFF; production ignores it).

Production `next build` + `next start` coverage lives in `e2e/restricted-prod.spec.ts` (`pnpm test:web-security`): blocked wallet, blocked geo, stale/unavailable, and allowed user on desktop and 390px mobile (CTA/banner layout), plus fail-closed / ignored LOCAL flags and the real #62 client-allow → write-gate 403 bypass. The production visual/a11y/reflow gate (`e2e/a11y.spec.ts` via `pnpm --filter web test:qa`) covers `/restricted` and a denied launch/token state with axe, `assertNoSubAaMutedText`, and 320px / 200% reflow. `/restricted` muted copy uses the approved AA floor (`text-zinc-400`). Dev/`next dev` coverage stays in `e2e/restricted.spec.ts` (`pnpm test:restricted`).

`/restricted` is a dynamic server page. It reads `?kind=` from the request and passes it into the client view so SSR and the first client paint match. The view does **not** call `useSearchParams()` (that pair with a text Suspense fallback caused intermittent React #418 hydration text/HTML mismatches under the production `next start` diagnostics gate). The operator-policy provider waits until after mount before fetching, and `useOperatorPolicy()` keeps returning pending until **that consumer** has mounted, so an instant mocked deny cannot paint banner/notice/CTA HTML before a Suspense child hydrates. Live `GET /api/operator-policy` still replaces the query hint after hydrate. The diagnostics / axe / muted-text AA gates are not weakened. Denied 320px / 200% reflow is one page per test.

## What the user sees

| UX kind | Machine `reason` (public) | Write CTAs |
| --- | --- | --- |
| Account | `DENY_ADDRESS_BLOCKED` | Disabled. Label: “Account unavailable.” |
| Location | `DENY_GEO_BLOCKED` | Disabled before any wallet transaction prompt. |
| Temporarily unavailable | `UNAVAILABLE_*` including `UNAVAILABLE_DATASET_STALE` / `UNAVAILABLE_DATASET_MISSING` | Disabled. Fail closed. |

`GET /api/operator-policy` (Next BFF) returns only the minimized public view: `decision`, `reason`, `kind`, `error`, `disclaimer`, `policy`, `writesAllowed`, `source`. It does **not** return raw IP, country/region ISO, ASN, SDN names, list UIDs, dataset hashes, HMAC/proof material, or screening-entry metadata.

Browser `sanctionsClear` / country / IP / claimed-wallet flags are ignored.

## What stays readable

Cosmetic denial of public market and docs reads is out of scope (**#62**). The board, search, token pages, charts, tape, `/docs`, and `/llms.txt` remain available. Connecting a wallet is not a write. Confirm / Launch / Quote / bid / claim stay disabled while the server decision is deny or unavailable.

## What these controls are — and are not

**Exist (operated services):** wallet-list screening and geographic restriction are server-side inputs to hosted write assistance (launch authorization, quote tickets, uploads). Exact official-list matching is **not** blockchain exposure or hop analytics. Official-list freshness (**#64**, merged **#70**) uses a **7-day SLA**: stale or missing data is never treated as clear. A bad or partial refresh keeps last-known-good on the operator side; the launchpad still fail-closes writes as temporarily unavailable until a current snapshot is active. There is no automated override because a user complains.

**Cannot do:** stop public chain reads; stop direct calls to Factory / Router / Curve / Hook; rewrite 2/1/0.5; seize locked LP. This is not a protocol pause and not a compliance certification. Do not use “fully OFAC compliant,” “legally approved,” or “sanctions-proof.”

Do not document VPN, proxy, Tor, or other bypass methods.

See [Trust](/docs/trust), [Operator policy](/docs/operator-policy), [Sanctions ops](/docs/sanctions-ops), [Address screening](/docs/sanctions), [API](/docs/api), [Admission](/docs/admission), [Traders](/docs/traders), [Creators](/docs/creators), [Browser security](/docs/web-security).
