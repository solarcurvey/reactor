# SDK

`@reactor/sdk` **0.3.3** — thin client for the public indexer. Factory version is a different number (**V1**).

## Authorize a launch

`ReactorClient.authorize` posts `POST /launch/authorize`. It does **not** talk to the isolated signer.

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
});
if (out.decision === "CHALLENGE") {
  // render widget, collect token, retry — CHALLENGE ≠ ALLOW
}
// out.auth + out.signature → InstantLaunchModule / Factory
```

On ALLOW the body includes `launchConfigHash`. The signer recomputes it. A mismatch is a hard fail.

## Markets board

`ReactorClient.markets` calls `GET /markets`. Pass `sort` (`new` / `vol` / `price`) with `cursor_ts` + `cursor_token` from `next_cursor`. `cursor_ts` is that sort’s key, not always a timestamp.

## Quote tickets

Helpers consume `POST /quote`:

- Use returned `tx.to` / `tx.data` / `amountOut`. Hops, `amountOut`, and `minOut`s are one candidate.
- Apply slippage locally. Refuse `minOut` ≤ 1.
- On SELL, `minQuoteOut` is the first official/bonding quote floor from the same selected preview; `minOut` is the final USDC floor. Do not treat `amountIn` as `minQuoteOut`.
- Preserve hop `kind` and `feeLegs[]` in the UI.

`@reactor/core` exports `planCandidates`, `applyMinOuts`, `ValuationService`, `rankTop10`, `consensusUsd6`, `launchBlockedByValuation`, `evaluateAdmission`, `fairCurveConfig`, `launchConfigHash`. Official ranks are `GET /top10` on the indexer — do not recompute from RPC. External USD is a configured provider registry + consensus.
