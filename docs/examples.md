# Examples

> Protocol **0.2.0**. Local Anvil 5042002.

## SDK — board + authorize

```ts
import { ReactorClient } from "@reactor/sdk";

const client = new ReactorClient({ baseUrl: "http://127.0.0.1:43148" });
const board = await client.markets({ q: "cat", limit: 20, offset: "0" });
const auth = await client.authorize({
  ticker: "CAT",
  name: "Cat",
  quote: "0x...",
  wallet: "0x...",
  mode: "rewards",
  turnstile: "<token>",
});
// auth.decision === "ALLOW" and auth.signature, or CHALLENGE / DENY
```

## Quote ticket (nested fees)

```bash
curl -s http://127.0.0.1:43148/quote -H 'content-type: application/json' -d '{
  "kind": "BUY",
  "token": "0xTOKEN",
  "tokenIn": "0xUSDC",
  "tokenOut": "0xTOKEN",
  "amountIn": "1000000",
  "slippageBps": 100
}'
```

Each official REACTOR leg is a separate 3.5% `feeLeg` (2% holders / 1% / 0.5% CORE). If a RouteGraph edge cannot be simulated, `ok: false` — never `minOut` 0 or 1.

## SSE

```ts
client.stream((ev) => console.log(ev.type, ev.data));
```
