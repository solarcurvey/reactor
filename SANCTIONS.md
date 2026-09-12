# Sanctions dataset + exact-address screening

**Engineering risk-reduction only. This is not legal advice and is not OFAC / sanctions “compliance.”**

REACTOR screens **exact digital-currency addresses** published on official U.S. Treasury / OFAC machine-readable lists. It does **not**:

- attribute hops, counterparties, clusters, or “exposure”
- implement a launch/trade policy gate (RELEASE GATE #60 children)
- geo/IP-block anyone
- replace counsel, a licensed screening vendor, or an OFAC compliance program

Issue **#61** (child of RELEASE GATE **#60**). Library: `@reactor/sanctions`. Indexer lookup: `GET /sanctions/screen`, `GET /sanctions/dataset`.

## Official sources (HTTPS only)

Documented by OFAC ([data formats](https://ofac.treasury.gov/specially-designated-nationals-list-data-formats-data-schemas), [digital-currency FAQ](https://ofac.treasury.gov/faqs/topic/1626)):

| Id | URL |
| --- | --- |
| `ofac-sdn-xml` | `https://www.treasury.gov/ofac/downloads/sdn.xml` |
| `ofac-sdn-advanced-xml` | `https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml` |
| `ofac-consolidated-xml` | `https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml` |
| `ofac-consolidated-advanced-xml` | `https://www.treasury.gov/ofac/downloads/sanctions/1.0/cons_advanced.xml` |

Default refresh fetches SDN classic + SDN advanced. Host allowlist: `www.treasury.gov`, `ofac.treasury.gov`, `sanctionslistservice.ofac.treas.gov`. HTTP and third-party mirrors are rejected.

Digital-currency rows are `Digital Currency Address - <TICKER>` (classic `idType` / advanced `FeatureType`). Passport and other IDs are ignored.

## Dataset version (immutable)

Each activated set records:

- `retrievedAt`
- per-source URL / id, HTTP metadata (`ETag`, `Last-Modified`), publication/update fields when present (`Publish_Date` / `DateOfIssue`, `Record_Count`)
- SHA-256 of each source body and of the normalized address set
- `parserVersion` (`PARSER_VERSION` in `packages/sanctions/src/types.ts`)

`current.json` is replaced with `write + rename`. A partial or broken download does not swing the pointer.

## Screening API

`screen(address)` / `GET /sanctions/screen?address=` returns an explicit decision — never a boolean:

| Decision | When |
| --- | --- |
| `blocked` | Exact canonical key is on the active official-list set (even if the set is stale) |
| `clear` | Current, compatible dataset and no exact match |
| `unavailable` | Missing dataset, incompatible parser, stale miss, or invalid query |

`unavailable` / stale **must not** be treated as `clear`. Response always includes `datasetVersion` (or `null`) and a disclaimer.

EVM identity is the canonical 20-byte hex (`evm:0x` + lowercase). Checksum casing does not affect a match. Bitcoin Base58 is case-sensitive. Families are never collapsed into one key (BTC ≠ ETH).

## Runbook

```bash
# Deterministic parser / store / screen (pinned fixtures, no network)
pnpm --filter @reactor/sanctions test
# also included in pnpm --filter indexer test and pnpm test:lib

# Optional live official fetch (not unit CI)
SANCTIONS_NETWORK=1 pnpm test:sanctions:network

# Activate pinned fixtures into a data dir (local demo)
pnpm --filter @reactor/sanctions refresh -- --dir ./packages/sanctions/data --fixtures

# Official HTTPS refresh (ops)
SANCTIONS_DATA_DIR=./apps/indexer/data/sanctions pnpm --filter @reactor/sanctions refresh
# or POST /ops/sanctions/refresh (ops token)
```

Env: `SANCTIONS_DATA_DIR` (default `apps/indexer/data/sanctions`), `SANCTIONS_MAX_AGE_MS` (default 7 days).

Indexer startup **loads last-known-good** from disk. It does **not** fetch OFAC at boot. Missing/stale data → `unavailable`, not `clear`.

## Later #60 children (not this change)

- Server policy gate (deny launch/trade on `blocked`; fail-closed on `unavailable`)
- Geo/IP controls
- UX copy

See `/docs/sanctions`, `THREAT_MODEL.md`.
