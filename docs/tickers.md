# Ticker registry

Global `TickerRegistry`. Survives Factory versions. `verifyingContract` for LaunchAuthorization EIP-712.

## Normalize

ASCII uppercase alphanumeric, length 1–10. `Ticker.normalize`. Spaces, hyphens, and non-ASCII revert `BadTicker`.

## Reserved vs locked

| Kind | How | Token |
| --- | --- | --- |
| Reserved | `reserveTicker` (Guardian) | `address(0)` + permanent |
| 24h lock | Successful launch `claimOnLaunch` | The launched token |
| Permanent | `permanentlyLockTicker(ticker, token)` | Must be REACTOR-native, matching ticker |

Default reserved set: `CORE`, `REACTOR`, `USDC`, `ZEC`, `WBTC`, `EURC`. Reserved names are **not** the same as a permanent lock of a live market.

## 24h lock

A successful Instant or Fair launch locks the ticker for 24 hours globally. A failed or expired authorization does **not** squat. After expiry, another token may claim the same ticker.

`permanentlyLockTicker` **reverts** (`TickerUnavailable`) if a **different** token still holds that active 24h lock. After expiry, Guardian may lock the current native token. Repeat lock on the same token reverts `TickerPermanent`. Wrong ticker → `TickerMismatch`. Non-native after expiry → `NotReactorNative`. `token == 0` is `ReservedSeparate`.

See `TICKER_REGISTRY.md`, [Admission](/docs/admission).
