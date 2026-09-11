# Launch admission

Offchain `LaunchAdmissionService` (indexer) plus onchain `LaunchAuthorization`.

## Onchain (every launch, including USDC)

EIP-712 `LaunchAuthorization` signed by the isolated **Launch Signer** (≠ Keeper ≠ Guardian Safe). Guardian rotates the signer.

Bound: creator, quote, factory, ticker, curve config, `virtualQuote0`, unique `authId`, deadline (≤30 min). Replay is digest-level on `TickerRegistry`. No serial quote nonce.

usdPegOne quotes still need the signature (anti-spam + ticker + active factory). `virtualQuote0` must match protocol geometry (or 0 → protocol default).

## Offchain signals → ALLOW / CHALLENGE / DENY

Ticker, quote, factory, metadata, wallet, session, IP, ASN, Cloudflare Turnstile, global rate, funding-cluster, image-hash.

Global issuance throttle: `NORMAL` / `ELEVATED` / `ATTACK` (env `ISSUANCE_LEVEL`). Guardian still has `pauseLaunches`.

**No KYC.** A refundable launch bond is **FUTURE only** — not collected.

## APIs

| Route | Who |
| --- | --- |
| `POST /launch/admit` | Public + partner (`x-partner-key`) |
| `POST /launch/authorize` via isolated signer (`/api/launch-pricing` proxy) | Creator UI / SDK |
| `GET /ticker/:ticker` | Anyone |
| `@reactor/sdk` `ReactorClient` | Third-party terminals |
