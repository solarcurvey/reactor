# Trust assumptions

1. **Top-10 ranks are an offchain API.** Contracts check structure only.
2. Launch Signer prices non-$1 quotes. Not an onchain oracle. Admission + receipt required.
3. Indexer charts, 24h USD, and candles can lag or be wrong. Onchain truth wins.
4. Guardian can pause, quarantine, rotate signer, permanently lock tickers. Cannot steal locked LP or change 2/1/0.5.
5. Designated Keeper runs maintenance. One lease (`leader_locks.lease_until` in **milliseconds**, `BIGINT`). Simulated minOut. Cannot configure.
6. Cloudflare Turnstile + issuance bucket are offchain. A bypassed LOCAL env is not production.
7. Funding-cluster is a heuristic (network + optional first funder). Not KYC, not chain analysis.
8. Arc Testnet PoolManager is not deployed. Local demo uses official v4-core under BUSL (non-production).
9. R2/S3 and ZEC HTTP are fail-closed in PROD. Missing config disables those paths.
10. This repo is **not audited**. Do not deploy to Arc Mainnet (5042).

See `THREAT_MODEL.md`, `AUDIT_HANDOFF.md`.
