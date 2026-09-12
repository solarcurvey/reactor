# Trust assumptions

1. **Top-10 ranks are an offchain API.** Indexer ValuationService + persisted `current_supply` produce `GET /top10`. A snapshot older than 15 minutes is not served or submitted. Contracts check structure only.
2. Launch Signer prices non-$1 quotes via ValuationService (multi-source consensus). Not an onchain oracle. Admission + receipt required. Provider outage or deviation refuses the signature. The isolated signer **fail-closes** if the durable store is down — it must not skip receipt consume or the signed-auth issuance bucket.
3. Indexer charts, 24h USD, and candles can lag or be wrong. Onchain truth wins. A tick does not leave events without a cursor (or a cursor without those events): protocol logs, token burn journal / `current_supply` writes, and `indexer_state` advance in one transaction. That is crash consistency, not an oracle. Bounded `totalSupply()` reconcile can still repair `current_supply`; it does not replace the journal.
4. Guardian can pause, quarantine, rotate signer, permanently lock tickers. Cannot steal locked LP or change 2/1/0.5.
5. Designated Keeper runs maintenance. One lease (`leader_locks.lease_until` in **milliseconds**, `BIGINT`) with renew + acquire-generation fence (TTL is failover, not a tick budget). Simulated minOut. Cannot configure.
6. Cloudflare Turnstile + issuance bucket are offchain. A bypassed LOCAL env is not production. Store unavailability is an outage (503), not a throttle bypass.
7. Funding-cluster is a heuristic (network + optional first funder). Not KYC, not chain analysis.
8. Arc Testnet PoolManager is not deployed. Local demo uses official v4-core under BUSL (non-production).
9. R2/S3 and the external price registry are fail-closed in PROD. Missing providers or a static-only config disable those quote launches. Accepted/rejected marks are persisted for the watchdog.
10. Public JSON POSTs are stream-capped at 16KiB default / 64KiB hard max (Content-Length and chunked). Upload is 2MB. Limits stop unbounded buffering; they are not a DoS proof.
11. **Token metadata is untrusted in the browser.** Names, tickers, descriptions, social URLs, and images are never rendered as HTML. URL schemes are allowlisted (`https:` / loopback `http:`). Images are first-party `/m/<id>.webp` or `/icons/…` only. Production CSP + security headers are in [Browser security](/docs/web-security). Admission DENYs `javascript:` / `data:` / HTML names before sign. The UI still sanitizes on read.
12. This repo is **not audited**. Do not deploy to Arc Mainnet (5042).

See `THREAT_MODEL.md`, `AUDIT_HANDOFF.md`.
