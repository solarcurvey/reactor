# `@reactor/sanctions`

Zero-license-cost exact digital-currency address screening from official OFAC / U.S. Treasury machine-readable lists.

**Not legal or OFAC compliance. No hop / exposure attribution.**

```ts
import { openSanctionsStore, refreshSanctions, screen } from "@reactor/sanctions";

const store = openSanctionsStore({ dataDir: "./data/sanctions" });
const result = store.screen("0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa");
// result.decision is "blocked" | "clear" | "unavailable" — never a silent boolean
```

See `SANCTIONS.md` and `/docs/sanctions`.
