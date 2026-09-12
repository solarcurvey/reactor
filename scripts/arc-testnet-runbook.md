# Arc Public Testnet — full deploy + production web runbook (#16)

Use this after `pnpm arc:rehearsal`. **Keep issue #16 open** until Instant launch + BUY/SELL have explorer hashes. Never invent addresses. Never deploy chain `5042`.

## 0. Disposable key (VM)

```bash
export PATH="$PATH:$HOME/.foundry/bin"
cast wallet new --json > /tmp/reactor-testnet-deployer.json   # chmod 600; never commit
# record only the address in the report
export ARC_TESTNET_ADDRESS=0x…      # public
export ARC_TESTNET_PK=0x…           # secret, not Anvil #0
export ARC_TESTNET_RPC=https://rpc.testnet.arc.io
```

`cast wallet new` is the only generator this runbook uses. Mainnet keys are forbidden.

## 1. Verify chain 5042002

```bash
cast chain-id --rpc-url https://rpc.testnet.arc.io      # 5042002
cast chain-id --rpc-url https://rpc.testnet.arc.network # 5042002
```

If Cloudflare **1010** appears, retry with a browser User-Agent or use a documented alternate from [Arc RPC docs](https://docs.arc.io/arc/references/rpc-endpoints) (`rpc.blockdaemon.testnet.arc.io`, `rpc.drpc.testnet.arc.io`, `rpc.quicknode.testnet.arc.io`). Still require `eth_chainId == 0x4cef52`.

## 2. Fund native gas (USDC-18)

1. Open https://faucet.circle.com
2. Currency **USDC**, network **Arc**
3. Paste `$ARC_TESTNET_ADDRESS`
4. Complete **Google reCAPTCHA** (v3, v2 checkbox fallback)
5. Wait, then:

```bash
cast balance $ARC_TESTNET_ADDRESS --rpc-url $ARC_TESTNET_RPC
```

Automation hits `POST https://faucet.circle.com/api/graphql` mutation `RequestToken` and receives:

```json
{"errors":[{"message":"ReCAPTCHA verification failed","extensions":{"code":"RECAPTCHA_ERROR"}}]}
```

Circle Developer `POST https://api.circle.com/v1/faucet/drips` (`blockchain: ARC-TESTNET`) returns **401** without a mainnet-upgraded Circle API key. Arc docs list no other faucet.

Protocol quote USDC is the 6-decimal ERC-20 `0x3600000000000000000000000000000000000000`. Do not treat gas-18 as that token.

## 3. Deploy dependency stack + Factory

PoolManager is **not** on Arc Public Testnet. `script/Deploy.s.sol` deploys official v4-core (BUSL, **non-production**) plus Guardian / modules / Factory V1.

```bash
cd contracts && forge build --sizes && cd ..
pnpm size:guard
pnpm arc:factory-attempt          # probe + optional Factory create
# Full stack — only with funded PK, chain 5042002
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_TESTNET_RPC" \
  --broadcast --legacy \
  --private-key "$ARC_TESTNET_PK"
```

Copy the broadcast addresses into **`deployments/arc-testnet.json`** (do not overwrite `deployments/local.json` without labeling). Point `deployments/registry.json` `arc-public-testnet.addressFile` at that file. Set `sourceCommit` to the git SHA. `claimed` stays **false** until [testnet.arcscan.app](https://testnet.arcscan.app) shows the create receipts. Then `pnpm docs:gen`.

Production-shaped Guardian = Safe ≠ deployer: `SAFE_GENESIS=true` + `pnpm safe:genesis`. See `scripts/arc-testnet-checklist.md`.

## 4. Production Next + indexer

```bash
cp deployments/arc-testnet.env.example .env.production
# fill Turnstile, isolated signer PK (≠ deployer ≠ Keeper), HMAC, R2
pnpm arc:prod-web                 # writes env examples; refuses claimed=true without explorer URL
REACTOR_ENV=PROD pnpm --filter indexer signer
REACTOR_ENV=PROD pnpm --filter indexer dev
REACTOR_ENV=PROD pnpm --filter web build && pnpm --filter web start
```

PROD refuses missing Turnstile, `SIGNER_INLINE`, or Anvil `#0` signer.

## 5. Instant + BUY/SELL harness

Same ABIs as `apps/web/src/lib/contracts.ts`. Same admission path as the launch page (`POST /launch/authorize` → `launchStandard` → `POST /quote` → `UserRouteExecutor.buy` / `sell` with nonzero `minOut` / `minQuoteOut`).

```bash
pnpm arc:wallet-harness           # public testnet; exits 2 if Factory has no code
# optional local proof only (not a testnet claim):
pnpm arc:wallet-harness -- --local
```

Issue **#35** has no harness in this tree; this script is the production-shaped stand-in.

## 6. Claim rule

`claimed: true` only when all of these are true:

1. `txHash` on [testnet.arcscan.app](https://testnet.arcscan.app) is success
2. Created code matches `forge build` runtime
3. A human recorded the explorer URL in `deployments/registry.json`

Until then: **claimed false**. Issue #16 stays open. Addresses #16 in the PR; do not close the issue from a faucet-blocked run.
