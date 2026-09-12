# Ticker registry

> Global `TickerRegistry`. Survives Factory versions. `verifyingContract` for LaunchAuthorization EIP-712.

Tickers are protocol identity, not a Factory-owned string. The same registry outlives V1/V2. Source: `TICKER_REGISTRY.md`.

## Normalize

ASCII uppercase alphanumeric, length **1–10**. `Ticker.normalize` in Solidity and `packages/reactor/src/ticker.ts`. Spaces, hyphens, and non-ASCII revert `BadTicker`.

`TICKER_LOCK_SECONDS = 24 * 60 * 60`. `docs:check` fails if Solidity and TypeScript disagree.

## Reserved vs locked

| Kind | How | Token |
| --- | --- | --- |
| Reserved | `reserveTicker` (Guardian) | `address(0)` + permanent |
| 24h lock | Successful launch `claimOnLaunch` | The launched token |
| Permanent | `permanentlyLockTicker(ticker, token)` | Must be REACTOR-native, matching ticker |

Default reserved set: `CORE`, `REACTOR`, `USDC`, `ZEC`, `WBTC`, `EURC`. Reserved names are **not** the same as a permanent lock of a live market.

## 24h lock

A successful Instant or Fair launch locks the ticker for **24 hours** globally. A failed or expired authorization does **not** squat. After expiry, another token may claim the same ticker.

`permanentlyLockTicker` **reverts** (`TickerUnavailable`) if a **different** token still holds that active 24h lock. After expiry, Guardian may lock the current native token. Repeat lock on the same token reverts `TickerPermanent`. Wrong ticker → `TickerMismatch`. Non-native after expiry → `NotReactorNative`. `token == 0` is `ReservedSeparate`.

Guardian lock is a one-way qualitative judgment, **not** a market-cap oracle.

## API

`GET /ticker/:ticker` returns canonical status, the 24h lock, and the latest token.

Onchain, `claimOnLaunch` is factory-only and also consumes the LaunchAuthorization digest (`usedAuthorization`). Replay is digest-level. No serial quote nonce.

See [Admission](/docs/admission), [Creators](/docs/creators), `TICKER_REGISTRY.md`.
