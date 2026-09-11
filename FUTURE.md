# Future work (recorded, not built)

These are explicit **non-goals** for this hardening pass.

## CircleWarp / CCTP

Cross-chain USDC via Circle CCTP (burn on Ethereum/Base/Arbitrum, mint on Arc, auto-buy). Requires source-chain messengers, attestation, and a dedicated keying model. **Not implemented.**

## UBI agent SDK / MCP

No verified public SDK/license. An agent surface would be a new product. **Not implemented.**

## ArcPad SSE / indexer

Server-sent events and a richer discovery index. REACTOR’s indexer is a local SQLite poller on official events + PoolManager `Swap` for sqrtPrice. SSE fan-out is **not built**.

## TOLLY chart UX

Professional trading-terminal charts (order tape, depth, multi-timeframe). Token page shows a **pool sqrtPrice series** when the indexer saw both `Swap` and `SwapFeeAccrued`. Full charting stack is **not built**.

## Uniswap CCA

CCA factory `0x000000001F26a0044BaA66024e7b6599c61963F8` has been observed with code on Arc Testnet historically, but it cannot mint an Official REACTOR Pool (0% LP + this hook). V1 ships **Batch Fair Launch** instead. Genuine CCA is a future infra decision, not a rename.

## Arc Public Testnet / mainnet

No dedicated funded test key is assumed in this environment. **Do not claim Arc Testnet or mainnet deployment.** Local Anvil chain 5042002 only unless a later run produces real explorer txs.
