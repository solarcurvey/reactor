# CORE

`CoreToken` — name **REACTOR CORE**, symbol **CORE**. `TestCORE` is a deprecated alias. Tokenomics unchanged.

- 1,000,000,000 minted once: 100M vest + 900M locked official CORE/USDC
- Never a Top-10 member
- Official CORE book: 2.5% burn + 1% flywheel (not the launch-token 2/1/0.5)
- Real `burn()`, no dead-address
- `registerNative` on the quote registry is **not** silent — Factory forwards failures so a graduated token is actually registered

Live UI: a bottom-right toast appears when the indexer has committed `BuybackExecuted` / `COREBurned` (SSE `core`, `confirmed`, `id >` first-session `hello.head`). Dedupe is `(chainId, tx, logIndex, eventKind)`. This is not an onchain oracle and not a Top-10 event — CORE never ranks.

See `CORE_GENESIS.md` and `CORE_LIQUIDITY_DESIGN.md`.
