# Sanctions operator runbook

> **Not legal advice. Not OFAC / sanctions “compliance.”** Operated-service playbook for issue **#64**. Public contracts stay callable. See [Sanctions ops](/docs/sanctions-ops) and [Incident response](/docs/incident-response).

Exact versions on `GET /health` → `sanctions`, `GET /sanctions/health`, and `/ops`.

## Refresh failure

1. Read `sanctions.refresh.lastError`, `consecutiveFailures`, and `dataset.versionId` (this is last-known-good).
2. Confirm `current.json` was **not** replaced (pointer version matches the last success).
3. `POST /ops/sanctions/refresh` with the ops token. A 422 keeps last-known-good.
4. If official HTTPS is down, do **not** load an unofficial file and do **not** enable fixtures in STAGING/TESTNET/PROD. Wait or restore from a known-good `versions/<id>` already on disk.
5. After three consecutive failures the indexer pages `sanctions_refresh_failed`.
6. Protected writes stay fail-closed if the snapshot is also past the 7-day SLA.

## Suspected false positive

1. Collect the user-visible reason code and `ref {request_id}`. The audit line has `addr:` + hash, not the raw wallet.
2. Re-screen against the **active** dataset version shown in health. Do not trust a client “clear” flag or a claimed `body.wallet` / `x-reactor-wallet` — only the #62 recovered proof is identity.
3. Open `POST /ops/sanctions/review` with `kind=operator_explicit`, operator id, and a written reason.
4. A user complaint (`kind=user_complaint`) is rejected (`NO_AUTOMATED_OVERRIDE`). Nothing is delisted.
5. If Treasury later removes the address, wait for the next official refresh. Do not hand-edit the list.

## OFAC list update

1. Official files change on Treasury hosts. Scheduled refresh (6h) + startup should pick them up.
2. Health `dataset.versionId` / `contentHash` / `retrievedAt` / `lastSuccessfulRefreshAt` must move together.
3. A valid-but-gutted parse (address count or source bytes collapse) is rejected. Use an explicit shrink override only after human review — never the default.
4. After activate, confirm a known listed fixture still `blocked` and an unlisted wallet is `clear` only while freshness is `current`.

## Geo-policy update

1. Geo policy version is `GEO_POLICY_VERSION` (default `us-comprehensive-sanctions.r1`, aligned with #63).
2. Ship a new revision as a reviewed config change. Health must show the new `policy.geoPolicyVersion`.
3. Browser `CF-IPCountry` / `X-Forwarded-For` are not authority. Unknown geo fails closed on protected writes.

## Emergency disable of operated write assistance

1. `POST /ops/sanctions/writes` `{ "enabled": false, "operator": "…" }` or set `SANCTIONS_OPERATED_WRITES=0` and restart.
2. All REACTOR-operated writes return `OPERATED_WRITES_DISABLED` (503). Onchain contracts are unchanged.
3. The action is audit-logged. Re-enable with `{ "enabled": true }` only after the dataset/policy is current.

## Evidence preservation

1. Keep `SANCTIONS_DATA_DIR` (`current.json`, `refresh-state.json`, `versions/<id>/`). Do not prune the active version.
2. Export recent `alerts` rows (`sanctions_*`) and indexer logs with `kind=sanctions_audit` / `x-request-id`.
3. Do **not** dump raw request bodies, IPs, signatures, or keys into the ticket.
4. Record exact `dataset.versionId`, `contentHash`, `operatorPolicyVersion`, and `geoPolicyVersion`.

## Restore service

1. Confirm last-known-good is still pointed (`GET /sanctions/health`).
2. Successful official refresh → `freshness=current`, `consecutiveFailures=0`, alerts clear.
3. If writes were disabled, re-enable explicitly. Confirm a test allow path (LOCAL fixture) or a known-clear wallet on current data.
4. If the dataset is past SLA and refresh still fails, leave writes fail-closed. Do not “force clear.”
