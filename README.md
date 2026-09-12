# REACTOR

**Launch. Reflect. Burn.**  
**Choose what your token earns.** Launch markets that pay holders in the quote you pick.

Token launchpad for **Arc**. Official REACTOR pools are Uniswap v4 markets with a **0% LP fee** and a **3.5% quote-side protocol charge** (2% holders / 1% Top-10 flywheel / 0.5% CORE buy+burn). Maintenance is a designated Keeper. The only security authority is an immutable Guardian. Built on Arc.

> This repository is **not audited**. Do not deploy to Arc Mainnet (chain 5042).

Protocol release **0.3.3** (`v0.3.3`). Factory **V1** (`FACTORY_VERSION = 1`, immutable). Source of truth: `docs/version.json`. Changelog: `CHANGELOG.md`. Docs policy: `CONTRIBUTING.md`.

## Quick start (local Arc-compatible demo)

```bash
# Foundry
export PATH="$PATH:$HOME/.foundry/bin"
cd contracts
forge install   # v4-core e50237c4…, v4-periphery dce236d4…, forge-std
forge test

# Chain + protocol
cd ..
anvil --chain-id 5042002 --port 8545 --gas-limit 100000000
# new terminal — Factory V1 runtime is under EIP-170 (InstantLaunchModule split)
cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast

# Apps
pnpm install
REACTOR_ENV=LOCAL pnpm --filter indexer dev   # http://127.0.0.1:43148  Postgres if DATABASE_URL, else SQLite
# optional Postgres smoke + millisecond BIGINT test (docker compose postgres on :54329)
# docker compose up -d postgres
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg
REACTOR_ENV=LOCAL pnpm --filter indexer signer   # isolated pricing signer :43149
pnpm --filter web dev                 # http://127.0.0.1:43147
# optional — local Anvil only (KEEPER_MODE=LOCAL|DRY_RUN|ARC_TESTNET; mainnet disabled)
pnpm --filter indexer keeper          # Postgres jobs + advisory lock
pnpm --filter indexer watchdog        # independent heartbeat + on-chain epoch check
```

Open `http://127.0.0.1:43147`. Connect a wallet to **chain 5042002** (Anvil). Import anvil account 0 if needed.

Addresses land in `deployments/local.json` after the demo script.

## What you can do

1. **Choose a quote** — Instant is a **bonding curve → locked v4 graduation** (creator picks image/name/ticker/description/quote/Standard vs Rewards/optional Dev Buy only). Or **Batch Fair Launch** (pro-rata timed sale → migrate). Not Uniswap CCA.
2. Trade **exact-in** on the Official REACTOR Pool. The UI simulates, applies slippage, and submits a **nonzero minOut**. Incomplete fills revert.
3. Claim holder rewards in the quote asset — no staking.
4. Designated Keeper settles flywheel quote→USDC, submits Top-10 epochs, and runs CORE / SelfBurn buy+burn through approved adapters. Each job takes a **chunk** (20%) + cooldown and a Keeper-supplied `minOut` — not the whole pot, not `minOut=1`.
5. THE REACTOR (`/reactor`) — 1% Top-10. API **discovers** graduated markets on-chain (official prices, nested quote/USD, $250k floor, fail closed). Contracts check structure only. CORE never ranks. Not a trustless oracle.
6. **Every launch, including USDC**, needs a short-lived EIP-712 `LaunchAuthorization` from the isolated **Launch Signer** (≠ Keeper ≠ Guardian Safe). usdPegOne quotes still use protocol geometry for `virtualQuote0`; EURC is **not** $1. Unique `authId`, digest-level replay, no serial quote nonce. Ticker lock is onchain via global `TickerRegistry`.
7. Transfer launch tokens with **zero tax**; rewards persist. When Rewards `eligibleSupply==0`, the 2% goes to SelfBurn (not the first holder).
8. Homepage is the indexer `GET /markets` board (pagination/filter/sort, live SSE). Trade tickets come from `POST /quote` — nested official 3.5% legs are listed separately.

## Network

| | Arc Public Testnet | This demo |
| --- | --- | --- |
| Chain ID | 5042002 (verified) | 5042002 |
| RPC | https://rpc.testnet.arc.io (live) | local anvil |
| USDC | `0x3600…0000` 6 decimals | Mock USDC-6 |
| v4 PoolManager | **not deployed** | Official v4-core, BUSL non-production |

We **do not claim Arc Testnet success** unless transactions appear on [testnet.arcscan.app](https://testnet.arcscan.app).

In-app docs: [`/docs`](http://127.0.0.1:43147/docs) (sidebar, search, TOC). Source: `docs/`. `llms.txt` at `/llms.txt`.

```bash
pnpm docs:check   # fail on fee / supply / Dev Buy / ticker lock / factory / version / deployment drift
pnpm docs:gen     # regenerate versioning + deployments + changelog pages from config
pnpm safe:genesis # Safe Transaction Builder JSON from deployments/local.json (deployer ≠ Safe)
```

**Production (`REACTOR_ENV=PROD` or `NODE_ENV=production`):** the indexer and isolated signer refuse to start if `TURNSTILE_SECRET` / site key are missing, if `SIGNER_INLINE` is on, or if the Anvil `#0` signer fallback would be used. `LOCAL` may keep those bypasses.

**Media:** `sharp` is required. On a fresh host, `pnpm approve-builds` (allow `sharp`) if the install asks.

**Arc Public Testnet:** this repo does not claim a Factory deploy without an explorer hash. If `ARC_TESTNET_PK` is unset, see `deployments/arc-testnet-blocker.md`.

## Protocol notes

| File | Contents |
| --- | --- |
| `TICKER_REGISTRY.md` | Global ticker lock + normalize |
| `CONTRIBUTING.md` | Docs-mandatory policy + release/tag rules |
| `CHANGELOG.md` | Production protocol releases (baseline 0.1.0) |
| `docs/version.json` | Protocol semver source of truth |
| `FACTORY_VERSIONING.md` | Immutable factories; new launches only |
| `LAUNCH_ADMISSION.md` | EIP-712 + Turnstile + throttle |
| `CORE_GENESIS.md` | CORE 10/90 genesis, vesting, 2.5/1.0 book |
| `CORE_LIQUIDITY_DESIGN.md` | Single-sided CORE/USDC ticks and lock |
| `CURVE_DESIGN.md` | Frozen Instant bonding constants and sim |
| `GUARDIAN_MODEL.md` | Only privileged security authority |
| `KEEPER_MODEL.md` | Designated Keeper, routing, Top-10 trust |
| `PROJECT.md` | Product scope |
| `ARCHITECTURE.md` | Modules and trust boundaries |
| `ECONOMICS.md` | Immutable 2 / 1 / 0.5 split, flywheel, eligibility |
| `DECISIONS.md` | ADRs + primary-source research |
| `THREAT_MODEL.md` | Attacks and residual risk |
| `TESTING.md` | How to test |
| `TESTNET_DEPLOYMENT.md` | Verified Arc params |
| `AUDIT_HANDOFF.md` | Hostile-reader brief |
| `AGENTS.md` | Invariants for future agents |
| `BUILD_REPORT.md` | Evidence for this build |
| `COMPETITIVE_REVIEW.md` | Dated public-source review |
| `FUTURE.md` | Explicitly not built |
| `PRIVILEGE_MAP.md` | Guardian / Keeper / one-time slots |
| `HARDENING_REPORT.md` | P0/P1 findings and proof |

## License

REACTOR contracts: MIT.  
Uniswap v4-core: BUSL-1.1 (non-production use until 2027-06-15). See `DECISIONS.md` ADR-005.
