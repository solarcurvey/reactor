# Arc Public Testnet rehearsal — issue #16

**claimed: true on explorer API** (Blockscout `status=ok`, `result=success`). Keep #16 open for human AC. Not Safe genesis. Not audited. No mainnet.

| Field | Value |
| --- | --- |
| Issue | [#16](https://github.com/solarcurvey/reactor/issues/16) |
| Deployer (public address only) | `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E` |
| Funding | ~10 native USDC-18 from box throwaway (Circle GraphQL still `RECAPTCHA_ERROR` from this VM) |
| Verified chain | **5042002** via `https://rpc.testnet.arc.network` |
| Factory | [`0xB48D1B397834eBcccb8961041d827487097e0535`](https://testnet.arcscan.app/address/0xB48D1B397834eBcccb8961041d827487097e0535) |
| Factory create | [`0xa7297d2104b926b9372d93d16598fd5e8c4171955b0e5d3b6ce6ce0468752c67`](https://testnet.arcscan.app/tx/0xa7297d2104b926b9372d93d16598fd5e8c4171955b0e5d3b6ce6ce0468752c67) |
| Guardian create | [`0x9a1c798f2c9f3b901aa6b28ecc4eec0d57ca1fdcb70a84f1429b2e25f1f60187`](https://testnet.arcscan.app/tx/0x9a1c798f2c9f3b901aa6b28ecc4eec0d57ca1fdcb70a84f1429b2e25f1f60187) |
| Instant/Fair quote | Mock USDC-6 `0x44CBe037ABFA8696E4466cA9D278Dbbe44B932dC` (not canonical `0x3600…0000`) |
| Dump | `deployments/arc-testnet.json` → `docs/deployments.md` |
| Mainnet 5042 | blocked |

## Instant + Fair smoke

| Step | Token / id | Tx |
| --- | --- | --- |
| Instant launch RHRSI | `0x62A7aDF0deb2c1918603e9834dD9ACe07CDA2f87` | [`0xde5fb884…`](https://testnet.arcscan.app/tx/0xde5fb884a0495f15715963a710d3e1efd3f93237c22978ee351e15d726c77f6f) |
| Instant buy | 10 Mock USDC-6 | [`0xf50b7715…`](https://testnet.arcscan.app/tx/0xf50b7715ed981d379c9c37cf6badb227e047e15b2e932cd194088a8fa73886b3) |
| Instant sell | 25% of buy | [`0x71d6f3ec…`](https://testnet.arcscan.app/tx/0x71d6f3ecbfd4c3a7de02d2fb5f477d6c22a40bec12115ea951c99731565e25cd) |
| Fair create RHRFA | `0x077322bE71C871F7134a9bb97e8f85A3991497c6` fairId 1 | [`0xb1a993e9…`](https://testnet.arcscan.app/tx/0xb1a993e9ce3c4261e1b2c6ee5b6cc92ca2fced4c9029b6960eabcbb979f0f46f) |
| Fair bid | 5 Mock USDC-6 | [`0xf2d8b9a3…`](https://testnet.arcscan.app/tx/0xf2d8b9a3f2407f037196506d4081c33f8787bcc62d1cff541f9f0c20bef362cb) |
| Fair finalize | — | [`0xe839d3d2…`](https://testnet.arcscan.app/tx/0xe839d3d2230bb20448117149e61fed7c92ebe4307fcebeb886b8e65ca49d24c5) |
| Fair claim | — | [`0x78f3f4ad…`](https://testnet.arcscan.app/tx/0x78f3f4adefe400cb452b022d15f2c0fcf99e44ca16abae29c553d83bb1e42ffb) |

Raw: `deployments/arc-testnet-smoke.json`. Signer was the Guardian EOA (not Turnstile / indexer `/launch/authorize`).

## RPC probes (earlier this run)

Primary Circle RPCs were called with a browser User-Agent. Some datacenter clients without that header receive Cloudflare **1010**.

| RPC | Status | chainId |
| --- | --- | --- |
| `https://rpc.testnet.arc.io` | live | 5042002 |
| `https://rpc.testnet.arc.network` | live | 5042002 |
| `https://rpc.blockdaemon.testnet.arc.io` | live | 5042002 |
| `https://rpc.drpc.testnet.arc.io` | live | 5042002 |
| `https://rpc.quicknode.testnet.arc.io` | live | 5042002 |

eth_chainId 0x4cef52 = 5042002

## Canonical code on 5042002 (not REACTOR)

| Item | Address | Role |
| --- | --- | --- |
| USDC ERC-20 (6 decimals, usdPegOne) | `0x3600000000000000000000000000000000000000` | Arc canonical — **not** the #16 Instant/Fair quote |
| CREATE2 (Arachnid) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | Hook miner |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Present |
| CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` | Present |

## Faucet (still blocked for automation)

https://faucet.circle.com/api/graphql → HTTP 200 RECAPTCHA_ERROR. Circle `/v1/faucet/drips` → HTTP 401. This run used a human box throwaway transfer instead.

## Production web journey

Direct Factory Instant + Fair smoke is done. Production Next + indexer + Turnstile `/launch/authorize` + `pnpm arc:wallet-harness` was **not** the smoke path. Keep #16 open.

Then re-run (never commit the key):

```bash
export ARC_TESTNET_PK=0x…          # never commit
export ARC_TESTNET_ADDRESS=0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E
export ARC_TESTNET_RPC=https://rpc.testnet.arc.network
pnpm arc:rehearsal
pnpm arc:smoke
pnpm arc:wallet-harness
```
