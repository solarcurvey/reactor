# SDK

```ts
import { ReactorClient, normalizeTicker } from "@reactor/sdk";

const client = new ReactorClient({ baseUrl: "http://127.0.0.1:43148" });
const t = await client.ticker("moon");
const board = await client.markets({ q: "zec", limit: 40 });
```

`normalizeTicker` matches `Ticker.sol`. Do not ship a different alphabet.

Launch Signer and Keeper keys never belong in a terminal. Next.js only proxies `/api/launch-pricing` and fails closed if the signer is down.
