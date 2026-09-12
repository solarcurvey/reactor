# Restricted access

> Offchain REACTOR-operated services only. Protocol **0.3.3**. Factory **V1**. Not a legal or OFAC-compliance opinion.

The public launchpad has a dedicated **`/restricted`** state when a server policy decision refuses REACTOR-operated write assistance. Copy is neutral: operated services are unavailable for this **request**, **account**, or **location**. The UI does not accuse anyone of unlawful conduct.

This is **not** an onchain pause. Immutable public contracts remain callable. The launchpad does not pretend it can censor permissionless chain reads.

Issue **#65** (child of RELEASE GATE **#60**). Server authority is **#62** (`evaluateOperatorPolicy`, merged **#68** on `main` `2002aed`), with address screening **#61** / **#66** and trusted geo **#63** / **#67**. Official decision read is `GET /operator-policy/status` (same evaluator as write gates). `GET /operator-policy/challenge` is a signing helper only. **LOCAL** continues to allow writes when the indexer status path is missing; **production-like** environments fail closed as temporarily unavailable.

## What the user sees

| UX kind | Machine `reason` (public) | Write CTAs |
| --- | --- | --- |
| Account | `DENY_ADDRESS_BLOCKED` | Disabled. Label: “Account unavailable.” |
| Location | `DENY_GEO_BLOCKED` | Disabled before any wallet transaction prompt. |
| Temporarily unavailable | `UNAVAILABLE_*` | Disabled. Fail closed. |

`GET /api/operator-policy` (Next BFF) returns only the minimized public view: `decision`, `reason`, `kind`, `error`, `disclaimer`, `policy`, `writesAllowed`, `source`. It does **not** return raw IP, country/region ISO, ASN, SDN names, list UIDs, dataset hashes, HMAC/proof material, or screening-entry metadata.

Browser `sanctionsClear` / country / IP / claimed-wallet flags are ignored.

## What stays readable

Cosmetic denial of public market and docs reads is out of scope (**#62**). The board, search, token pages, charts, tape, `/docs`, and `/llms.txt` remain available. Connecting a wallet is not a write. Confirm / Launch / Quote / bid / claim stay disabled while the server decision is deny or unavailable.

## What these controls are — and are not

**Exist (operated services):** wallet-list screening and geographic restriction are server-side inputs to hosted write assistance (launch authorization, quote tickets, uploads). If required checks cannot run, those writes fail closed.

**Cannot do:** stop public chain reads; stop direct calls to Factory / Router / Curve / Hook; rewrite 2/1/0.5; seize locked LP. This is not a protocol pause and not a compliance certification.

Do not document VPN, proxy, Tor, or other bypass methods.

See [Trust](/docs/trust), [API](/docs/api), [Admission](/docs/admission), [Traders](/docs/traders), [Creators](/docs/creators), [Browser security](/docs/web-security).
