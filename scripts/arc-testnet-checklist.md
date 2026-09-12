# Arc Public Testnet deploy checklist

Use this when `ARC_TESTNET_PK` is a **funded** EOA on chain `5042002`. If the key is missing, stop and keep `claimed: false`. See `deployments/arc-testnet-blocker.md`.

## Pre-flight

- [ ] `echo $ARC_TESTNET_PK` is set and is **not** Anvil `#0` (`ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`)
- [ ] `cast balance $DEPLOYER --rpc-url https://rpc.testnet.arc.io` shows faucet USDC-18 gas
- [ ] Faucet used: https://faucet.circle.com
- [ ] `cast chain-id --rpc-url https://rpc.testnet.arc.io` → `5042002`
- [ ] Confirm you are **not** on mainnet `5042`
- [ ] `pnpm size:guard` — Factory runtime ≤ 23,552
- [ ] Guardian Safe address ≠ deployer
- [ ] Launch Signer EOA ≠ Keeper ≠ Safe
- [ ] Canonical USDC `0x3600000000000000000000000000000000000000` (6 decimals) for `usdPegOne`
- [ ] PoolManager: if **not** on-chain, you must deploy official v4-core (BUSL, non-production) yourself — this repo does not invent an address

## Deploy

```bash
export ARC_TESTNET_RPC=https://rpc.testnet.arc.io
export ARC_TESTNET_PK=0x…          # never commit
export PATH="$PATH:$HOME/.foundry/bin"

pnpm arc:factory-attempt           # records probe; broadcasts Factory only if key + size ok

# Full stack (local script targets Anvil-shaped mocks — on testnet register canonical USDC, skip mock ZEC/BTC or label them)
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_TESTNET_RPC" \
  --broadcast --legacy \
  --private-key "$ARC_TESTNET_PK"
```

Use ≥ 20 gwei `maxFeePerGas` (Arc docs).

## Genesis (Safe)

```bash
export EXPECTED_SAFE=0x…           # ≠ DEPLOYER
export DEPLOYER=0x…
# fill GUARDIAN_CONTRACT, REGISTRY, FACTORY, USDC, … from the broadcast
pnpm safe:genesis                  # Batch A / Batch B JSON + MultiSend
forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url "$ARC_TESTNET_RPC"
# Then execute Batch B only
```

## Claim rule

Set `claimed: true` in `deployments/arc-factory-attempt.json` **only** after:

1. `txHash` is present
2. https://testnet.arcscan.app/tx/{hash} shows success
3. The created Factory code matches `forge build` runtime

Until then: **claimed: false**.
