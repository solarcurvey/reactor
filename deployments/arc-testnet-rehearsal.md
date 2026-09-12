# Arc Public Testnet rehearsal — issue #16

**claimed: false.** This file is live evidence from `2026-09-12T19:32:20.075Z`. Do not treat it as a successful Factory deploy.

| Field | Value |
| --- | --- |
| Issue | [#16](https://github.com/solarcurvey/reactor/issues/16) |
| Waiting deployer (public address only) | `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E` |
| Native gas (USDC-18) | 0 wei |
| Verified chain | **5042002** via `https://rpc.testnet.arc.io` |
| Factory claimed | **false** |
| Mainnet 5042 | blocked |

## RPC probes

Primary Circle RPCs were called with a browser User-Agent. Some datacenter clients without that header receive Cloudflare **1010**.

| RPC | Status | chainId | head | HTTP | Error |
| --- | --- | --- | --- | --- | --- |
| `https://rpc.testnet.arc.io` | live | 5042002 | 0x3aeacc0 | 200 | — |
| `https://rpc.testnet.arc.network` | live | 5042002 | 0x3aeacc2 | 200 | — |
| `https://rpc.blockdaemon.testnet.arc.io` | live | 5042002 | 0x3aeacc2 | 200 | — |
| `https://rpc.drpc.testnet.arc.io` | live | 5042002 | 0x3aeacc3 | 200 | — |
| `https://rpc.quicknode.testnet.arc.io` | live | 5042002 | 0x3aeacc3 | 200 | — |

eth_chainId 0x4cef52 = 5042002

## Canonical code on 5042002 (not REACTOR)

| Item | Address | Runtime bytes |
| --- | --- | --- |
| USDC ERC-20 (6 decimals, usdPegOne) | `0x3600000000000000000000000000000000000000` | 1798 |
| CREATE2 (Arachnid) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | 69 |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9152 |
| CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` | 24214 |

Uniswap v4 `PoolManager` is **not** claimed on Arc Public Testnet. This repo does not invent one.

## Faucet

https://faucet.circle.com/api/graphql → HTTP 200 RECAPTCHA_ERROR — ReCAPTCHA verification failed. Human reCAPTCHA required. Address is waiting for funds.

| Attempt | URL | HTTP | Result |
| --- | --- | --- | --- |
| GET | `https://faucet.circle.com` | 200 | Public faucet HTML (Next.js). Token drip is a GraphQL mutation gated by Google reCAPTCHA. |
| POST GraphQL RequestToken | `https://faucet.circle.com/api/graphql` | 200 | RECAPTCHA_ERROR — ReCAPTCHA verification failed |
| POST /v1/faucet/drips (no API key) | `https://api.circle.com/v1/faucet/drips` | 401 | {"code":401,"message":"malformed authorization. Missing API key in authorization header. Make sure to use Bearer authorization type"} |

Arc docs ([RPC endpoints](https://docs.arc.io/arc/references/rpc-endpoints), [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc)) list only `https://faucet.circle.com`. There is no permissionless alternate drip.

## Deploy

ARC_TESTNET_PK unset. No broadcast. Key must be a funded disposable test EOA (cast wallet new), never Anvil #0, never committed.

No `eth_sendRawTransaction` for Factory/modules.

## Production web journey

Instant + BUY/SELL harness requires a claimed Factory + funded trader. See `pnpm arc:wallet-harness`. Not claimed this run.

## Blockers

- https://faucet.circle.com/api/graphql → HTTP 200 RECAPTCHA_ERROR — ReCAPTCHA verification failed. Human reCAPTCHA required. Address is waiting for funds.

## Human unblock (keep #16 open)

1. Open https://faucet.circle.com — network **Arc**, token **USDC**, address `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E`. Complete the Google reCAPTCHA (v3 / v2 checkbox).
2. Confirm native gas: `cast balance $ADDR --rpc-url https://rpc.testnet.arc.io` is > 0.
3. Export `ARC_TESTNET_PK` (never commit) and re-run `pnpm arc:rehearsal` then the runbook deploy steps.
4. Record real addresses + tx hashes in `deployments/arc-testnet.json` and point `deployments/registry.json` at that file. `claimed` stays false until the explorer receipt is confirmed.
5. Configure production Next (`deployments/arc-testnet.env.example`) and run `pnpm arc:wallet-harness`.
6. Keep [#16](https://github.com/solarcurvey/reactor/issues/16) open until Instant launch + BUY/SELL land on https://testnet.arcscan.app.

Then re-run:

```bash
export ARC_TESTNET_PK=0x…          # never commit
export ARC_TESTNET_ADDRESS=0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E
export ARC_TESTNET_RPC=https://rpc.testnet.arc.io
pnpm arc:rehearsal
pnpm arc:wallet-harness
```

See `scripts/arc-testnet-runbook.md`.
