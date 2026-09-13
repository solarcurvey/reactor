# Arc Public Testnet deploy checklist

Use this when `ARC_TESTNET_PK` is a **funded** EOA on chain `5042002`. If the key is missing, stop and keep `claimed: false`. See `deployments/arc-testnet-blocker.md`. Full journey (issue #16): `scripts/arc-testnet-runbook.md` and `pnpm arc:rehearsal`.

## Pre-flight

- [ ] `echo $ARC_TESTNET_PK` is set and is **not** Anvil `#0` (`ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`)
- [ ] `cast balance $DEPLOYER --rpc-url https://rpc.testnet.arc.io` shows faucet USDC-18 gas
- [ ] Faucet used: https://faucet.circle.com
- [ ] `cast chain-id --rpc-url https://rpc.testnet.arc.io` → `5042002`
- [ ] Confirm you are **not** on mainnet `5042`
- [ ] `pnpm size:guard` — Factory runtime ≤ 23,552
- [ ] Guardian (`GUARDIAN` / `EXPECTED_SAFE`) ≠ deployer. This isolated round: Davis hardware EOA `0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406` — **not** a Gnosis Safe
- [ ] Launch Signer `0xd880BD31948Ffc89E8D26C6ac90f98F825E56E9e` ≠ Keeper `0xf2105235d0a74969f229deb72d3C8C578643147F` ≠ guardian ≠ Pricing Signer `0x346363d14E6Acf1b05CA8Aa22F7E06a201A69a76`
- [ ] Do **not** reuse SUPERSEDED `0x2CdF37541256749E5CF6ac5C806e0d23A685F224` / `0xB48D1B397834eBcccb8961041d827487097e0535` (lost disposable guardian key)
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

## Genesis (EOA guardian this round)

Constructors: `SAFE_GENESIS=true` + `GUARDIAN=0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406` on the ops box. Then:

```bash
export EXPECTED_SAFE=0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406   # Davis HW EOA, ≠ DEPLOYER
export DEPLOYER=0x…                                              # ops-box constructor EOA
# fill GUARDIAN_CONTRACT, REGISTRY, FACTORY, USDC, … from the NEW broadcast (do not invent)
forge script script/SafeGenesisBatch.s.sol:SafeGenesisBatch --rpc-url "$ARC_TESTNET_RPC"
# Davis HW-sends Batch A calldata, then:
forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url "$ARC_TESTNET_RPC"
# Then Batch B only — pauseLaunches(false) LAST
```

Full order: `scripts/arc-testnet-eoa-genesis-runbook.md`. `pnpm safe:genesis` JSON is optional ordering reference; no Gnosis Safe UI this round.

## Claim rule

Set `claimed: true` in `deployments/arc-factory-attempt.json` **only** after:

1. `txHash` is present
2. https://testnet.arcscan.app/tx/{hash} shows success
3. The created Factory code matches `forge build` runtime

Until then: **claimed: false**.
