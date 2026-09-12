# Trust assumptions

1. **Top-10 ranks are an offchain API.** The indexer ValuationService writes one persisted snapshot (`GET /top10`). Web and Keeper only read it. Contracts check structure only.
2. Launch Signer prices non-$1 quotes via ValuationService (multi-source consensus). Not an onchain oracle. Admission + receipt required. Provider outage or deviation refuses the signature. The isolated signer **fail-closes** if the durable store is down — it must not skip receipt consume or the signed-auth issuance bucket.
3. Indexer charts, 24h USD, and candles can lag or be wrong. Onchain truth wins. A tick does not leave events without a cursor (or a cursor without those events): log writes and `indexer_state` advance in one transaction. That is crash consistency, not an oracle.
4. Guardian can pause, quarantine, rotate signer, permanently lock tickers. Cannot steal locked LP or change 2/1/0.5.
5. Designated Keeper runs maintenance. One lease (`leader_locks.lease_until` in **milliseconds**, `BIGINT`). Simulated minOut. Cannot configure.
6. Cloudflare Turnstile + issuance bucket are offchain. A bypassed LOCAL env is not production. Store unavailability is an outage (503), not a throttle bypass.
7. Funding-cluster is a heuristic (network + optional first funder). Not KYC, not chain analysis.
8. Arc Testnet PoolManager is not deployed. Local demo uses official v4-core under BUSL (non-production).
9. R2/S3 and the external price registry are fail-closed in PROD. Missing providers or a static-only config disable those quote launches. Accepted/rejected marks are persisted for the watchdog.
10. This repo is **not audited**. Do not deploy to Arc Mainnet (5042).

See `THREAT_MODEL.md`, `AUDIT_HANDOFF.md`.
