# Exact official-list address screening

> **Not legal advice. Not OFAC / sanctions “compliance.”** Exact match against official U.S. Treasury / OFAC machine-readable digital-currency addresses only. No hop, cluster, or exposure attribution.

Library: `@reactor/sanctions` (Refs **#61**, parent RELEASE GATE **#60**). Protocol economics and Factory V1 are unchanged.

## What this is

The indexer can answer “is this exact address string on the last activated official list?” using a local cache. There is **no third-party screening API call per wallet request**.

| Route | Notes |
| --- | --- |
| `GET /sanctions/screen?address=` | `decision`: `blocked` / `clear` / `unavailable`. Includes `datasetVersion`, `freshness`, `disclaimer`. Optional `family` (`evm`, `btc`, …). |
| `GET /sanctions/dataset` | Active version + freshness. `policyGate` is `null` until a later #60 child. |
| `POST /ops/sanctions/refresh` | Ops token. Atomic official HTTPS refresh of **SDN + Consolidated** (classic and advanced). Failure or a valid-but-gutted parse keeps last-known-good. `SANCTIONS_ALLOW_SHRINK=1` is the explicit override. |

Decisions are **not** a boolean. A missing or stale dataset that does not already contain the address returns `unavailable`, never `clear`. A listed address still returns `blocked` even if the snapshot is stale.

## What this is not

- Not a launch or trade policy gate. Admission does **not** call `screen()` yet. Comments in `apps/indexer/src/admission.ts` point at later #60 children (server policy, geo/IP, UX).
- Not chain analysis, KYC, or hop tracing.
- Not a licensed vendor feed. Source of truth is Treasury/OFAC XML on `treasury.gov` / `ofac.treasury.gov` / `sanctionslistservice.ofac.treas.gov` over **HTTPS**.
- Not a claim that REACTOR is compliant with the sanctions laws of any jurisdiction.

## Normalization

- **EVM** (`Digital Currency Address - ETH` and other 20-byte hex): identity is 20 bytes. `0xAa…` and `0xaa…` match. Display checksum is not identity.
- **Unlike families stay unlike.** A Bitcoin address is never stored or queried as `evm:…`.
- Multi-rail tickers such as USDT use address **shape** (hex → EVM, `T…` → Tron). Shapes are not merged.

## Freshness

Default max age is **7 days** (`SANCTIONS_MAX_AGE_MS`). Refresh is explicit (CLI or ops) and always includes SDN and Consolidated machine-readable files. Completeness: keep ≥85% of last-known-good addresses (and per-source counts); source bodies must not shrink below 50% of prior bytes. A well-formed but catastrophically truncated parse does not activate. The indexer does not pull OFAC on every process start. CI uses **pinned fixtures** under `packages/sanctions/fixtures/`. Live HTTPS is `SANCTIONS_NETWORK=1 pnpm test:sanctions:network` only.

Runbook: `SANCTIONS.md`.
