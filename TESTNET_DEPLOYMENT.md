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
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| CREATE2 (Arachnid) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` (code **present**) |
| Uniswap v4 PoolManager | **Not deployed** (probed + not on Uniswap deployments page) |
| Mainnet | Chain 5042, scheduled ~2026-09-16 — **do not deploy** |

Gas: minimum `maxFeePerGas` 20 gwei. Base fee paid to beneficiary (no ETH-style burn).

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

## What gets deployed

1. `PoolManager` (official v4-core, BUSL non-production)
2. `QuoteAssetRegistry` (admin = deployer)
3. Mock USDC (local only) or register canonical USDC (testnet)
4. Mock ZEC / BTC / NVDA (labeled)
5. `TestCORE`
6. `ReactorLiquidityVault`, `BuybackVault`, `ReactorRouter`
7. `ReactorHook` via CREATE2 with mined permission bits
8. `ReactorFactory`
9. Hookless CORE/USDC pool + seed liquidity
10. Register quotes

Addresses are appended to `deployments/<network>.json`.

## License reminder

Deploying `PoolManager.sol` is **non-production use** under BUSL-1.1. Arc Mainnet production use is forbidden until an Additional Use Grant or the Change Date (2027-06-15).
