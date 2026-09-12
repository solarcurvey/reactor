# Sanctions screening ops

> **Not legal advice. Not OFAC / sanctions “compliance.”** Freshness, audit, and health for REACTOR-operated write assistance only. Public immutable contracts remain callable onchain. Protocol **0.3.3**. Factory **V1**.

Issue **#64** (child of RELEASE GATE **#60**). Address ingest is **#61**; the operator policy decision is **#62**; trusted geo is **#63**. This page is the ops layer that sits on those interfaces.

## Freshness SLA

The official-list dataset (`ofac-official-list-v1`) is **current** only while `now − retrievedAt ≤ 7 days` (`SANCTIONS_MAX_AGE_MS`, default `604800000`). Missing, unparseable, or older snapshots are **stale** or **missing** — never **clear**.

Protected writes (`POST /quote`, `/upload`, `/launch/admit`, `/launch/authorize`, isolated launch signer) fail closed on stale or unknown required policy. Reason codes match #62 (`UNAVAILABLE_DATASET_STALE`, `UNAVAILABLE_DATASET_MISSING`, …).

## Identity (consumed from #62)

#64 owns freshness, health, alerts, and the minimized audit line. It does **not** invent a wallet from the browser.

The gated and logged subject is the **same verified EIP-191 signer as #68** (`packages/reactor/src/wallet-proof.ts`). `extractWallet()` is a no-op (same as #68 `extractSubjectWallet`) and never reads `body.wallet` / `x-reactor-wallet`. When `apps/indexer/src/operator-policy.ts` is present, `recoverSubjectWallet` / shared `gateProtectedWrite` win. `body.wallet`, `body.creator`, `body.recipient`, `body.account`, and `x-reactor-wallet` are recorded as ignored client signals. Without a recovered proof the write fails closed (`UNAVAILABLE_WALLET_MISSING`) — a spoofed listed wallet is **not** `DENY_ADDRESS_BLOCKED`.

## Persist + refresh

Active version, content hash, retrieved time, official source metadata, and last successful refresh are persisted under `SANCTIONS_DATA_DIR` (`current.json`, `refresh-state.json`, `versions/<id>/`).

Refresh runs at **process start** and on a **6 hour** schedule (`SANCTIONS_REFRESH_INTERVAL_MS`). A bad, partial, or gutted replacement does **not** swing `current.json`. Last-known-good stays active; health is **degraded**. Completeness floor: keep ≥85% of prior addresses; each source body must stay ≥50% of prior bytes. `allowCatastrophicShrink` is an explicit operator exception, not a complaint path.

When the official `#61` module is present, refresh binds to it. **Fixture fallback is LOCAL / explicit test only** (`REACTOR_ENV=LOCAL` or `SANCTIONS_FIXTURE=1` outside production-like envs). `PROD`, `PRODUCTION`, `STAGING`, and `TESTNET` (and `NODE_ENV=production`) require the official source; a missing or broken plugin reports unavailable/stale. `SANCTIONS_FIXTURE=1` cannot override those hard-gated envs.

## Health

| Route | Notes |
| --- | --- |
| `GET /health` | Liveness plus `sanctions` (dataset version / hash, policy versions, freshness, refresh failures). |
| `GET /sanctions/health` | Same sanctions object without chain lag. |
| `GET /ops` | Ops token. Includes the same `sanctions` snapshot. Dashboard `/ops` renders exact versions. |
| `POST /ops/sanctions/refresh` | Ops token. Atomic refresh; failure returns last-known-good. |
| `POST /ops/sanctions/writes` | Ops token. Emergency enable/disable of operated write assistance. Logged. |
| `POST /ops/sanctions/review` | Ops token. Queues an explicit operator review. User complaints return `NO_AUTOMATED_OVERRIDE`. |

## Audit log

Every protected write / authorization attempt emits `kind=sanctions_policy_decision` with:

- timestamp
- coarse action (`quote`, `launch.admit`, `launch.authorize`, `launch.sign`, `upload`)
- allow / deny / unavailable reason code
- wallet **hash** of the recovered subject only (`addr:` + first 16 hex of SHA-256 of the lowercase address)
- dataset version id + content hash
- geo-policy version + operator policy version (`reactor-operator-policy-v1`)

Not logged by default: private keys, auth signatures, raw wallet-signing material, full request bodies, raw IP.

## Alerts

Existing indexer `alerts` table + `raiseAlert`:

| Code | When |
| --- | --- |
| `sanctions_dataset_stale` | Freshness is `stale` or `missing` |
| `sanctions_refresh_failed` | ≥3 consecutive refresh failures |
| `sanctions_policy_unavailable` | Policy evaluation injected/failed closed |

`SANCTIONS_INJECT=stale|refresh_fail|policy_fail|partial_refresh` is test-only failure injection.

## Overrides

There is **no** automated delist because a user complains. `POST /ops/sanctions/review` with `kind=user_complaint` is rejected. An explicit operator review (`kind=operator_explicit` + operator id + reason) is logged and **queued** — it does not flip a deny to allow.

See the [sanctions runbook](/docs/sanctions-runbook) and [incident response](/docs/incident-response).
