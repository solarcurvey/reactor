# SDK

`@reactor/sdk` **0.3.3** — thin client for the public indexer. Factory version is a different number (**V1**). Exact-address screening is `@reactor/sanctions` / `GET /sanctions/screen` (not in this client; not compliance). See [Address screening](/docs/sanctions).

## Authorize a launch

`ReactorClient.authorize` / `admit` post to the indexer. They do **not** talk to the isolated signer. The operator-policy gate runs first (recovered EIP-191 wallet proof + trusted geo). Pass `{ token, signature }` from `GET /operator-policy/challenge` + `personal_sign` as the second argument (or `body.walletProof`). A `decision` of `deny` / `unavailable` is not a `LaunchAuthorization`. Client “clear” flags and claimed wallet fields are ignored.

`ReactorClient.operatorPolicyChallenge` / `operatorPolicyStatus` are the public #62/#65 reads. Status is the official minimized decision (`reason` / `kind` / `writesAllowed`). Write gates remain authoritative.

```ts
import { ReactorClient } from "@reactor/sdk";

const client = new ReactorClient({ indexer: "http://127.0.0.1:43148" });
const out = await client.authorize({
  ticker: "CAT",
  name: "Cat",
  quote: "0x…",
  factory: "0x…",
  factoryVersion: 1,
  wallet: "0x…",
  mode: "rewards",
  turnstile: realWidgetToken, // from Cloudflare Turnstile, not a stub
}, proof); // { token, signature } from GET /operator-policy/challenge + personal_sign
if (out.decision === "CHALLENGE") {
  // render widget, collect token, retry — CHALLENGE ≠ ALLOW
}
// out.auth + out.signature → InstantLaunchModule / Factory
```

On ALLOW the body includes `launchConfigHash`. The signer recomputes it. A mismatch is a hard fail.

## Live stream

`ReactorClient.stream` opens `GET /stream` and listens for **named** events (`trade`, `launch`, `bonding`, `graduation`, `rewards`, `burn`, `top10`, `core`, `hello`). `onmessage` is not enough — the hub sets `event: <type>`. First-session `hello.head` is history. Resume with `?after=` / `Last-Event-ID`. Official buy+burn toasts use live `core` executes and `burn` + `Top10Buy`, keyed by `(chainId, tx, logIndex, eventKind)`.

## Markets board

`ReactorClient.markets` calls `GET /markets`. Pass `sort` (`new` / `vol` / `price`) with `cursor_ts` + `cursor_token` from `next_cursor`. `cursor_ts` is that sort’s key, not always a timestamp.

`ReactorClient.market(token)` is `GET /markets/:token`. `quoteAssets()` is `GET /quote-assets`. `tokenPage(token, interval)` is `GET /page/token/:token` (market + candles + swaps). Those are display APIs — use `POST /quote` for a ticket.

## Quote tickets

Helpers consume `POST /quote`:

- Use returned `tx.to` / `tx.data` / `amountOut`. Hops, `amountOut`, and `minOut`s are one candidate.
- Apply slippage locally. Refuse `minOut` ≤ 1.
- On SELL, `minQuoteOut` is the first official/bonding quote floor from the same selected preview; `minOut` is the final USDC floor. Do not treat `amountIn` as `minQuoteOut`.
- Preserve hop `kind`, `feeLegs[]`, and `aggregateProtocolImpactBps` in the UI. Those fields belong to the scored winner, not a higher-raw-output loser. Do not recompute official 3.5% from a single notional. Render each charged fee leg in **that hop’s quote asset and decimals**. Do not sum `holders` / `flywheel` / `core` across different quote tokens. When denoms differ, the only combined figure is `aggregateProtocolImpactBps`. Protocol tickets expose `exemptOfficialLegs[]`.

`@reactor/core` exports `planCandidates`, `applyMinOuts`, `ValuationService`, `consensusUsd6`, `launchBlockedByValuation`, `evaluateAdmission`, `fairCurveConfig`, `launchConfigHash`, and Top-10 rank helpers (`rankTop10`, VWAP, `acceptTop10Snapshot` / `TOP10_SNAPSHOT_TTL_SEC`). Official ranks still come from indexer `GET /top10`. External USD is a configured provider registry + consensus — not a separate ZEC pricer.

Geo policy (`evaluateGeoPolicy`) is a **server** helper. Do not call it from a browser or copy production ISO deny lists into a terminal. See [Geo policy](/docs/geo-policy).
