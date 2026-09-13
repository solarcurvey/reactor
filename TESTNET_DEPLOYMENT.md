# TESTNET DEPLOYMENT

## Verified Arc Public Testnet (2026-09-11)

Source: [docs.arc.io/arc/references/rpc-endpoints](https://docs.arc.io/arc/references/rpc-endpoints), [contract-addresses](https://docs.arc.io/arc/references/contract-addresses), live `eth_chainId`.

| Parameter | Value |
| --- | --- |
| Chain ID | `5042002` (`0x4CEF52`) |
| HTTP RPC | `https://rpc.testnet.arc.io` |
| WSS | `wss://rpc.testnet.arc.io` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| Native gas | USDC, **18** decimals internally |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000`, **6** decimals |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` — **not usdPegOne**; do not treat as $1 |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| CREATE2 (Arachnid) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` (code **present**) |
| Uniswap v4 PoolManager | No Circle/Uniswap canonical address. #16 rehearsal deployed official v4-core BUSL — see `docs/deployments.md` |
| Mainnet | Chain 5042, scheduled ~2026-09-16 — **do not deploy** |

Gas: minimum `maxFeePerGas` 20 gwei. Base fee paid to beneficiary (no ETH-style burn).

**Finality:** Arc is Malachite BFT — final on commit, no confirmation window, no reorgs ([docs](https://docs.arc.io/arc/concepts/deterministic-finality)). Indexer default `ARC_FINALITY_CONFIRMATIONS=0`. The Ethereum-style 8-block lag is dropped.

Buyback **testnet** safety constants are in `ReactorConstants` (300 bps impact, 20% chunk, 10% reserve, 1500 bps ref deviation, 5 min cooldown). See `ECONOMICS.md`.

#16 rehearsal (2026-09-12) recorded Factory + Instant/Fair smoke on explorer. That dump is **SUPERSEDED / non-PROD-isolated**: Guardian `0x2CdF37541256749E5CF6ac5C806e0d23A685F224` / Factory `0xB48D1B397834eBcccb8961041d827487097e0535` have immutable `guardian()` = lost disposable `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E`. Davis chose REDEPLOY. Isolated **constructors are live**: Guardian `0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934` (`guardian()` = Davis EOA `0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406`), Factory `0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA`, deployer `0x3E00CE2Dc40FaFB0D2dA4A5e6004278Fdf65AAF5`. `launchesPaused=true`. On-chain launch/pricing still = keeper until HW `SafeGenesisBatch`. `pauseLaunches(false)` LAST after VerifyGenesis. Dump: `deployments/arc-testnet-isolated.json`. No Instant/Fair smoke. `claimedProdPath` stays false. Runbook: `scripts/arc-testnet-eoa-genesis-runbook.md`. Keep #16 open.

**Circle faucet (2026-09-12 VM):** `POST https://faucet.circle.com/api/graphql` mutation `RequestToken` (`blockchain: ARC`, `token: USDC`) returns HTTP 200 with `extensions.code = RECAPTCHA_ERROR`. `POST https://api.circle.com/v1/faucet/drips` returns HTTP 401 without a Circle API key. This rehearsal was funded from a box throwaway wallet onto `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E`.

## Deploy REACTOR (local / funded testnet)

```bash
cd contracts
export PATH="$PATH:$HOME/.foundry/bin"

# Local Arc-compatible anvil (default demo)
anvil --chain-id 5042002 --port 8545

forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key $DEPLOYER_PK
```

If you have Circle-faucet USDC on Arc Testnet:

```bash
export ARC_TESTNET_RPC=https://rpc.testnet.arc.io
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_TESTNET_RPC \
  --broadcast \
  --legacy \
  --private-key $DEPLOYER_PK
```

Use at least 20 gwei. Never commit the key. `.env.example` lists variables.

Production-shaped local/testnet: set `GUARDIAN` / `EXPECTED_SAFE` to the **final** guardian (production: a Safe; this isolated testnet round: Davis hardware EOA `0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406`), `KEEPER` to the designated Keeper, `SAFE_GENESIS=true` (launches stay paused; deployer ≠ guardian). Then Batch A calldata from `SafeGenesisBatch.s.sol`, then:

```bash
forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url $RPC
```

Then Batch B with `pauseLaunches(false)` **last**. Never deploy with a temporary EOA Guardian and transfer later — this round's EOA **is** the immutable guardian.

## What gets deployed

1. `PoolManager` (official v4-core, BUSL non-production)
2. `ReactorGuardian` (immutable Guardian + Keeper)
3. `QuoteAssetRegistry` (Guardian-curated; usdPegOne on canonical USDC only)
4. Mock USDC (local only) or register canonical USDC (testnet)
5. Mock ZEC / BTC / NVDA (labeled)
6. `CoreToken` (`TestCORE` deprecated alias) genesis 100M vest + 900M LP
7. Official hooked CORE/USDC lock (`CoreLiquidityVault`) — not hookless
8. Vaults, router, hook CREATE2, factory, InstantCurve, UserRoute, adapters
9. `SAFE_GENESIS=true` keeps launches paused until the guardian (Safe, or this-round hardware EOA) enables via Batch B — `pauseLaunches(false)` last

Addresses are appended to `deployments/<network>.json`.

## License reminder

Deploying `PoolManager.sol` is **non-production use** under BUSL-1.1. Arc Mainnet production use is forbidden until an Additional Use Grant or the Change Date (2027-06-15).
