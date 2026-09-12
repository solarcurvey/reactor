# Local demo

> Protocol **0.3.3** · Factory **V1** · Anvil chain **5042002** · Not audited · No public mainnet

This is the supported way to run REACTOR on a laptop. It does **not** claim Arc Public Testnet or mainnet. Addresses land in `deployments/local.json` after the demo deploy. Never invent a chain-5042 address.

## Prerequisites

- Foundry **1.8+** (`forge`, `anvil`, `cast`)
- Node **22+** and `pnpm`
- Optional: Docker, if you want Postgres instead of SQLite

```bash
export PATH="$PATH:$HOME/.foundry/bin"
```

## Contracts

```bash
cd contracts
forge install   # v4-core e50237c4…, v4-periphery dce236d4…, forge-std
forge test
```

## Chain + protocol

```bash
# terminal 1
anvil --chain-id 5042002 --port 8545 --gas-limit 100000000

# terminal 2 — Factory V1 runtime is under EIP-170 (InstantLaunchModule split)
cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

The script writes `deployments/local.json` and copies it into the web and indexer apps. `pnpm docs:check` fails if those copies drift.

## Apps

```bash
pnpm install
REACTOR_ENV=LOCAL pnpm --filter indexer dev     # http://127.0.0.1:43148
REACTOR_ENV=LOCAL pnpm --filter indexer signer  # isolated pricing signer :43149
pnpm --filter web dev                           # http://127.0.0.1:43147
```

Optional:

```bash
# Postgres instead of SQLite
docker compose up -d postgres
DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke

# Keeper / watchdog — local Anvil only
pnpm --filter indexer keeper
pnpm --filter indexer watchdog
```

Open `http://127.0.0.1:43147`. Connect a wallet to **chain 5042002**. Import Anvil account 0 if needed.

In-app handbook: `http://127.0.0.1:43147/docs`. Machine-readable index: `/llms.txt`.

## What LOCAL is allowed to bypass

`REACTOR_ENV=LOCAL` may keep Turnstile and inline-signer bypasses when secrets are unset. That is a demo convenience.

**Production** (`REACTOR_ENV=PROD` or `NODE_ENV=production`, and not `LOCAL`) refuses to start if:

- `TURNSTILE_SECRET` or the site key is missing
- `SIGNER_INLINE` is on
- The signer would fall back to Anvil `#0`

A LOCAL bypass is not a production claim.

## Keeper modes on the demo

| Mode | Meaning |
| --- | --- |
| `LOCAL` | Anvil 5042002 |
| `DRY_RUN` | Simulate only |
| `ARC_TESTNET` | Public 5042002 RPC — still not a claimed deploy without an explorer hash |

Arc Mainnet **5042 is disabled** in Keeper and deploy scripts.

## Media

`sharp` is required. On a fresh host, `pnpm approve-builds` (allow `sharp`) if the install asks. Uploads fail closed if sharp does not work.

## Honest limits

- Local USDC is a **mock 6-decimal** ERC-20, not Arc native gas USDC.
- Local v4 `PoolManager` is official v4-core under **BUSL-1.1** (non-production).
- This repo does not claim a Factory on Arc Public Testnet without an explorer hash. If `ARC_TESTNET_PK` is unset, see `deployments/arc-testnet-blocker.md`.

See [Arc](/docs/arc), [Deployments](/docs/deployments), [Docs policy](/docs/policy).
