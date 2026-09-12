# Examples

Local indexer: `http://127.0.0.1:43148`. Replace `0x…` with a factory launch.

## Quote a USDC buy

```bash
curl -s http://127.0.0.1:43148/quote -H 'content-type: application/json' \
  -d '{"kind":"BUY","token":"0x…","tokenIn":"0xUSDC","tokenOut":"0x…","amountIn":"1000000","slippageBps":100}'
```

Expect `ok`, `minOut` > 1, `feeLegs[]`, hop `kind`s (`OFFICIAL_REACTOR_V4` / `EXTERNAL_V4_HOOKLESS` / `BONDING_CURVE`). Hops / `amountOut` / `minOut`s are one candidate. SELL also returns `minQuoteOut` in **quote** units (not `amountIn`). Submit `tx.to` + `tx.data`. A failed preview returns `ok: false`, not a dust floor.

## Authorize a launch

```bash
curl -s http://127.0.0.1:43148/launch/authorize -H 'content-type: application/json' \
  -d '{"ticker":"CAT","name":"Cat","quote":"0x…","factory":"0x…","wallet":"0x…","mode":"rewards","turnstile":"<real widget token>"}'
```

- `403` + `decision: CHALLENGE` → complete Turnstile → retry. Not a signature.
- `ALLOW` includes `launchConfigHash`, then `auth` + `signature`.
- Direct isolated-signer calls without a receipt fail. Isolated signer calls without a durable store fail closed (503), and do not skip receipt consume.

## Markets keyset

```bash
curl -s 'http://127.0.0.1:43148/markets?sort=vol&limit=20&cursor_ts=0&cursor_token=0x…'
```

`sort=vol` / `sort=price` are NUMERIC casts. Next page uses `next_cursor.cursor_ts` + `next_cursor.cursor_token` — and `cursor_ts` is that sort’s key (`volume_24h_usd6` / `price_usd6` / `updated_ts`), not a mismatched timestamp.

## Candles and tape

```bash
curl -s 'http://127.0.0.1:43148/candles/0x…?interval=5m&limit=300&before=1710000000'
curl -s 'http://127.0.0.1:43148/swaps/0x…?limit=200&before_id=0'
```

Gap-fill is bounded to `limit` (max 1000) buckets ending at `before` or now. `before` / `after` on candles; `before_id` on swaps.

## Valuation

```bash
curl -s 'http://127.0.0.1:43148/valuation?token=0x…'
```

One ValuationService. EURC is not $1 unless `usdPegOne`. PROD refuses a static ZEC mark.
