# PROJECT — REACTOR

**REACTOR** is a permissionless token-launch platform targeting Arc Public Testnet.

- **Token:** $CORE (TestCORE on testnet)
- **Tagline:** Launch. Reflect. Burn.
- **Secondary:** Launch markets that pay holders.
- **Display:** REACTOR / Built on Arc

Launch a normal ERC-20 into an Official REACTOR Pool (Uniswap v4, 0% LP fee, REACTOR hook). Every official swap charges **3.5% of quote notional** in the quote asset: **2%** holders, **1%** Top-10 flywheel, **0.5%** CORE buy+burn.

This repository is the V1 MVP: contracts, tests, indexer, and consumer web app.

## What this is

A complete economic loop:

1. Instant or Fair launch
2. Trade on the official hooked pool
3. Holders claim quote rewards (no staking)
4. Permissionless CORE buyback and burn
5. UI that shows only onchain numbers

## What this is not

Social feed, DMs, NFTs, governance, referrals, creator royalties, platform trading revenue, anti-external-pool enforcement, CORE staking, bridges, perps, native mobile, or profiles.

## Networks

| Network | Chain ID | Role |
| --- | --- | --- |
| Arc Public Testnet | 5042002 | Target. Deploy only with funded keys. |
| Local Arc-compatible | 5042002 | Default demo / CI (anvil). |
| Arc Mainnet | 5042 (scheduled ~2026-09-16) | **Out of scope. Do not deploy.** |

## Repo layout

```
/contracts     Foundry (Solidity 0.8.26, Cancun)
/apps/web      Next.js + wagmi/viem
/apps/indexer  Lightweight TS + SQLite cache
/deployments   Address books and E2E evidence
```

## Brand constraints (clean-room)

Study public launchpad UX hierarchy only. No proprietary copy, assets, logos, or exact text. No Marvel / Iron Man / Stark branding. Do not name the product “Arc Reactor”. Original concentric-ring mark. Dark graphite, luminous energy core, cyan/blue-white glow, crisp white type.
