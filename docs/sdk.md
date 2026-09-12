# SDK

> `@reactor/sdk` **{{sdkVersion}}** — thin client for the public indexer. Factory version is a different number (**{{factoryVersionLabel}}**). Exact-address screening is `@reactor/sanctions` / `GET /sanctions/screen` (not in this client; not compliance). See [Address screening](/docs/sanctions).

The SDK talks to the indexer public/partner API. No keys on `authorize`. No KYC. It does **not** talk to the isolated signer.

`ReactorClient.authorize` / `admit` post to the indexer. They do **not** talk to the isolated signer. The operator-policy gate runs first (recovered EIP-191 wallet proof + trusted geo). Pass `{ token, signature }` from `GET /operator-policy/challenge` + `personal_sign` as the second argument (or `body.walletProof`). A `decision` of `deny` / `unavailable` is not a `LaunchAuthorization`. Client “clear” flags and claimed wallet fields are ignored. The public launchpad maps those codes to `/restricted` and disables write CTAs.

`ReactorClient.operatorPolicyChallenge` / `operatorPolicyStatus` are the public #62/#65 reads. Status is the official minimized decision (`reason` / `kind` / `writesAllowed`). Write gates remain authoritative. [Restricted access](/docs/restricted-access).

## Client

```ts
import { ReactorClient } from "@reactor/sdk";

const client = new ReactorClient({
  baseUrl: "http://127.0.0.1:43148",
  // apiKey: "…" // optional partner key for /launch/admit only
});
```

Constructor options are `{ baseUrl, apiKey? }`. There is no `indexer` field.

| Method | Indexer route |
| --- | --- |
| `client.markets({ sort, cursor_ts, cursor_token, … })` | `GET /markets` |
| `client.ticker(raw)` | `GET /ticker/:ticker` |
| `client.admit(body)` | `POST /launch/admit` (sends `x-partner-key` when `apiKey` is set) |
| `client.authorize(body)` | `POST /launch/authorize` |
| `client.stream(onEvent)` | `GET /stream` (`EventSource`) |

## Authorize a launch

```ts
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

`authorize` / `quote` may return `UNAVAILABLE_DATASET_STALE` (or sibling #62 reason codes) when operated policy is stale or missing. That is fail-closed server policy, not a client flag. `@reactor/core` exports `evaluateOperatorPolicy` and the sanctions-ops health/audit helpers.

## Live stream

`ReactorClient.stream` opens `GET /stream` and listens for **named** events (`trade`, `launch`, `bonding`, `graduation`, `rewards`, `burn`, `top10`, `core`, `hello`). `onmessage` is not enough — the hub sets `event: <type>`. First-session `hello.head` is history. Resume with `?after=` / `Last-Event-ID`. Official buy+burn toasts use live `core` executes and `burn` + `Top10Buy`, keyed by `(chainId, tx, logIndex, eventKind)`.

## Markets board

`ReactorClient.markets` calls `GET /markets`. Pass `sort` (`new` / `vol` / `price`) with `cursor_ts` + `cursor_token` from `next_cursor`. `cursor_ts` is that sort’s key, not always a timestamp.

`ReactorClient.market(token)` is `GET /markets/:token`. `quoteAssets()` is `GET /quote-assets`. `tokenPage(token, interval)` is `GET /page/token/:token` (market + candles + swaps). Those are display APIs — use `POST /quote` for a ticket.

## Quote tickets

Quote is `POST /quote` on the indexer (not a `ReactorClient` method). Helpers in `@reactor/core`:

- Use returned `tx.to` / `tx.data` / `amountOut`. Hops, `amountOut`, and `minOut`s are one candidate.
- Apply slippage locally. Refuse `minOut` ≤ 1.
- On SELL, `minQuoteOut` is the first official/bonding quote floor from the same selected preview; `minOut` is the final USDC floor. Do not treat `amountIn` as `minQuoteOut`.
- Preserve hop `kind`, `feeLegs[]`, and `aggregateProtocolImpactBps` in the UI. Those fields belong to the scored winner, not a higher-raw-output loser. Do not recompute official 3.5% from a single notional. Render each charged fee leg in **that hop’s quote asset and decimals**. Do not sum `holders` / `flywheel` / `core` across different quote tokens. When denoms differ, the only combined figure is `aggregateProtocolImpactBps`. Protocol tickets expose `exemptOfficialLegs[]`.

## `@reactor/core` exports

`planCandidates`, `pickBest`, `applyMinOuts`, `ValuationService`, `consensusUsd6`, `launchBlockedByValuation`, `evaluateAdmission`, `fairCurveConfig`, `launchConfigHash`, `INSTANT_CURVE_V1`, `FAIR_V1`, `normalizeTicker`, `RESERVED_TICKERS`, Top-10 rank helpers (`rankTop10`, VWAP, `acceptTop10Snapshot` / `TOP10_SNAPSHOT_TTL_SEC`), and `MaintenanceJob` EIP-712 helpers. Official ranks still come from indexer `GET /top10`. Relayers submit signed jobs to `AutomationGateway` — they do not rank.

Also re-exported from `@reactor/sdk`: `normalizeTicker`, `tryNormalizeTicker`, `isReservedTicker`, `MAX_TICKER_LEN`, `RESERVED_TICKERS`, `evaluateAdmission`, `serializeLaunchAuth`, `INSTANT_CURVE_V1`, `FAIR_V1`.

External USD is a configured provider registry + consensus — not a separate ZEC pricer.

Geo policy (`evaluateGeoPolicy`) is a **server** helper. Do not call it from a browser or copy production ISO deny lists into a terminal. See [Geo policy](/docs/geo-policy).

See [API](/docs/api), [Examples](/docs/examples), [Builders](/docs/builders), [Automation](/docs/automation), [Operator policy](/docs/operator-policy).
