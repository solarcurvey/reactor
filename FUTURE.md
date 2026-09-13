# Future work (recorded, not built)

These are explicit **non-goals** for this hardening pass.

## Official OFAC dataset ingest / trusted geo HMAC (#61 / #63)

This tree’s #62 gate binds merged #66 `sanctions.ts` (`indexerSanctionsStore().screen`) and merged #67 `geo-policy-resolve.ts` (`evaluateRequestGeo`) via `tryBindOfficialPolicyPlugins`. Dataset refresh and geo HMAC live in those modules — not reimplemented here.

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

## RELEASE GATE #60 children (after #61)

`@reactor/sanctions` is exact official-list ingestion + lookup only. **Not implemented here:**

- Server policy gate (deny launch/trade on `blocked`; fail-closed on `unavailable`)
- Geo/IP controls
- UX copy for blocked / unavailable

Do not treat `GET /sanctions/screen` as a compliance product.

## Arc Public Testnet / mainnet

No dedicated funded test key is assumed in this environment. **Do not claim Arc Testnet or mainnet deployment.** Local Anvil chain 5042002 only unless a later run produces real explorer txs.
