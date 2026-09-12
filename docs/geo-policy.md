# Geo policy (server)

> Issue **#63**. Policy layer only. Not an HTTP enforcement gate. Not a legal opinion. Not a claim of OFAC compliance.

The indexer exposes **one** server-side geo decision: `evaluateRequestGeo` → `ALLOW` | `DENY` | `UNKNOWN` plus a stable reason code. Downstream issue **#62** decides whether a decision blocks a request. This page does not add UI copy (#65), address screening (#61), or an ops runbook (#64).

## Decision

| Decision | Meaning |
| --- | --- |
| `ALLOW` | Trusted claim is not on the active deny revision. |
| `DENY` | Trusted claim matches a comprehensive jurisdiction or region on the active revision. |
| `UNKNOWN` | No trusted claim, stale/invalid MAC, missing region metadata, unlocated anonymizer, or inactive policy. |

Reason codes: `ALLOW_JURISDICTION_NOT_LISTED`, `DENY_COMPREHENSIVE_JURISDICTION`, `DENY_COMPREHENSIVE_REGION`, `UNKNOWN_UNTRUSTED_SOURCE`, `UNKNOWN_MISSING_GEO`, `UNKNOWN_REGION_METADATA_UNAVAILABLE`, `UNKNOWN_ANONYMIZER_UNLOCATED`, `UNKNOWN_INVALID_CLAIM`, `UNKNOWN_STALE_CLAIM`, `UNKNOWN_POLICY_INACTIVE`.

VPN / proxy / Tor, when the edge forwards a signal, is **`confidence: "best_effort"`** only. A suspected VPN on an allowed country is still `ALLOW`. Tor / anonymous-proxy country codes (`T1`, `A1`) are `UNKNOWN_ANONYMIZER_UNLOCATED`. The layer never invents certainty.

## Trusted source (production)

Country and region come from **deployment-edge metadata** or a **verified reverse-proxy** HMAC. The process does **not** trust:

- `CF-IPCountry`, `CF-Region`, `X-Vercel-IP-Country`, `CloudFront-Viewer-Country`
- `X-Country`, `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`
- Browser-set `x-reactor-geo-*` without a valid MAC
- `x-reactor-geo-fixture` (LOCAL only)

The edge strips client copies, then sets:

| Header | Role |
| --- | --- |
| `x-reactor-geo-ts` | Unix seconds |
| `x-reactor-geo-country` | ISO 3166-1 alpha-2 |
| `x-reactor-geo-region` | ISO 3166-2 (optional) |
| `x-reactor-geo-region-name` | Signed alias (optional; covered by the MAC) |
| `x-reactor-geo-anonymizer` | `none` / `suspected_vpn` / `suspected_proxy` / `suspected_tor` |
| `x-reactor-geo-ip` | Edge-observed client IP (not used to infer country) |
| `x-reactor-geo-mac` | hex HMAC-SHA256 |

Canonical payload (LF-separated): `v1`, `ts`, `country`, `region`, `regionName`, `anonymizer`, `ip`. Secret: `GEO_EDGE_SECRET` (≥16 chars). Skew: `GEO_EDGE_MAX_SKEW_SEC` (default 90). Compact form: `x-reactor-geo: v1.<ts>.<country>.<region>.<anonymizer>.<mac>` (no region name).

`GEO_EDGE_KIND=deployment_edge` labels the claim source; the default label is `verified_reverse_proxy`. Missing secret in a production-like env yields `UNKNOWN_UNTRUSTED_SOURCE` — this layer does not refuse process start.

There is **no** bundled GeoIP database. The indexer does not map IP → country itself.

## Versioned deny policy

Production revisions live in `apps/indexer/config/geo-policy-us-comprehensive.v1.json` (`kind: "production"`). Each revision records `revision`, `effectiveDate`, and a `source` (publisher / title / URL / retrieved). Revision **1** (effective 2026-09-12) maps comprehensive U.S. programs only:

- Jurisdictions: `CU`, `IR`, `KP`, `SY` (31 CFR 515 / 560 / 510 / 542).
- Regions: Crimea `UA-43`, Sevastopol `UA-40` (E.O. 13685); Donetsk `UA-14`, Luhansk `UA-09` (E.O. 14065).

Russia, Belarus, Venezuela, and other **sectoral / list-based** programs are **not** in revision 1. A different split of this list is a new revision of this file, not a UI `if (country === …)` branch.

## Region metadata

When the active revision has region rules for a country (Ukraine in v1) and the trusted claim has **no** ISO 3166-2 region, the decision is `UNKNOWN_REGION_METADATA_UNAVAILABLE`. The layer does not deny the whole country and does not pretend the visitor is outside the listed regions. Unrecognized region *names* (not ISO codes) also fail closed as `UNKNOWN`. Occupied-territory aliases (`Crimea`, `DNR`, `LNR`, `Sevastopol`) match even if a provider attributes the point to `RU`.

## LOCAL / test

`REACTOR_ENV=LOCAL` (and unset + non-production `NODE_ENV`) always loads `FIXTURE_GEO_POLICY`:

- Denied fixture country: `FX`
- Region-restricted fixture country: `FY` / `FY-99`
- Production ISOs are **absent**. `GEO_DENY_COUNTRIES`, `GEO_POLICY_KIND=production`, and the production JSON path cannot activate them.

LOCAL geo is the `x-reactor-geo-fixture` header (or an in-process `createFixtureClaim`). Production ignores that header.

## What this is not

- Not wired as a request gate on `/quote`, `/launch/authorize`, or the web app.
- Not OFAC SDN / address screening.
- Not KYC.
- Not a trustless onchain control.
- Not user-facing restriction copy.

See [Trust](/docs/trust), [API](/docs/api), `THREAT_MODEL.md`.
