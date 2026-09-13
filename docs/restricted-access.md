# Restricted access

> Offchain REACTOR-operated services only. Protocol **0.3.3**. Factory **V1**. Not a legal or OFAC-compliance opinion.

The public launchpad has a dedicated **`/restricted`** state when a server policy decision refuses REACTOR-operated write assistance. Copy is neutral: operated services are unavailable for this **request**, **account**, or **location**. The UI does not accuse anyone of unlawful conduct.

This is **not** an onchain pause. Immutable public contracts remain callable. The launchpad does not pretend it can censor permissionless chain reads.

Issue **#65** (child of RELEASE GATE **#60**). Server authority is **#62** (`evaluateOperatorPolicy`, merged **#68** on `main` `2002aed`), with address screening **#61** / **#66**, trusted geo **#63** / **#67**, and official-list freshness **#64** / merged **#70** (`cc82cd4`). This branch binds the launchpad to the official recovered-wallet model:

- `GET /operator-policy/status` is the official decision read (same `evaluateOperatorPolicy` as write gates). Optional `x-reactor-wallet-proof` screens the recovered signer. Claimed `wallet` / country / `clear` are ignored.
- `GET /operator-policy/challenge` issues an HMAC + EIP-191 message (`REACTOR operator-policy v1`, purpose `operator-policy-write`). It is not a decision.
- Writes (`POST /quote`, `/launch/admit`, `/launch/authorize`, `/upload`) require that recovered proof.
- Next `GET /api/operator-policy` forwards only the proof header (never a claimed wallet). The provider acquires challenge → `personal_sign` → proof header. Production `next start` fail-closes if the indexer status path is missing.

The indexer process uses official `apps/indexer/src/operator-policy.ts`. `operator-policy-bind.ts` is the #65 test/fixture adapter and delegates to that module when present.

**LOCAL** continues to allow writes when the indexer status path is missing; **production-like** environments fail closed as temporarily unavailable. LOCAL-only demo fixtures: `OPERATOR_POLICY_UX_FIXTURE`, `x-reactor-ux-fixture`, or a page `?fixture=` query (the provider forwards it to the BFF; production ignores it).

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
