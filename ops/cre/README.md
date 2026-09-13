# Chainlink CRE — maintenance job courier (honest status)

REACTOR does **not** claim that Chainlink CRE decentralizes Top-10 ranking, pricing-health, or route floors. CRE is one optional **relayer**. The decision service signs a `MaintenanceJob`; CRE (or Gelato, or any EOA) only delivers it to `AutomationGateway`.

## Same job interface

Workflows must submit the EIP-712 `MaintenanceJob` already used by the Keeper daemon and `packages/reactor/src/maintenance-job.ts`:

- Domain: `REACTOR.AutomationGateway` / `1` / `chainId` / gateway
- Typed entrypoints or `onReport(bytes,bytes)` decoding `(Job, signature, typedArgs)`
- No generic `target.call`

`workflow.ts` is that courier. It does not rank, simulate minOut, or substitute hops.

## Arc Testnet (CRE catalog)

Chainlink documents **Arc Testnet** as a CRE TypeScript network (EIP-155 **1883**, selector name `arc-testnet`, CLI ≥1.0.7, TS SDK ≥1.3.1). Simulation forwarder (local `--broadcast` only): `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1`. Production testnet forwarder: `0x76c9cf548b4179F8901cda1f8623568b58215E62`.

This repo’s local demo chain is **5042002**. Those are not the same network. A CRE tenant must still have the chain enabled (`cre workflow supported-chains`).

The #51 Arc Testnet CRE **simulator** AC is **not closed**. Official `cre workflow simulate` requires a CRE tenant (`cre login` or `CRE_API_KEY`). This agent environment has neither; `cre login --non-interactive` refuses; public CI ships **no secrets** (#74). The committed auth-blocked CLI transcript is **not** that AC. Do not reword the AC to accept the auth blocker.

Official **`cre workflow build`** (CLI v1.33.0, offline, no tenant) **did** compile this courier to WASM against catalog context `arc-testnet` / EIP-155 **1883**. Evidence: `simulation/cre-workflow-build.json` (`kind: cre-cli-workflow-build`). That is **not** a `Workflow Simulation Result` and does **not** close the simulate AC. Pin `@chainlink/cre-sdk` at **1.20.0** — `1.21.0` publishes `cre-sdk-javy-plugin` as `workspace:*` and cannot `bun install`.

What this tree *does* record: the signed `MaintenanceJob` courier project (`maintenance-courier`), official WASM compile, the HTTP payload, the encoder/handler, and local-forge / Anvil failover on 5042002. Not a live CRE DON. Not a claimed Arc Testnet protocol deploy.

## #51 operational ACs (honest)

| AC | Closed in this draft? | Evidence |
| --- | --- | --- |
| Same job interface as daemon / Gateway | **Yes** | `ops/cre/workflow.ts` `relayCalldata` / `creReport` encode the signed `MaintenanceJob`. Sidecar `simulation/failover-calldata-identity.json` |
| Official CRE WASM compile (`cre workflow build`) | **Yes (compile only)** | CLI v1.33.0, no tenant. `simulation/cre-workflow-build.json` — `compiled=true`, binary hash `675c914d…`. Encode identity matches the Node handler. Not a simulate AC. |
| Arc Testnet CRE **simulator** proof | **No — remaining external blocker** | #51 still requires a **successful** authenticated `cre workflow simulate` (WASM compile + `Workflow Simulation Result`) on catalog `arc-testnet` / EIP-155 **1883** using the signed `MaintenanceJob` HTTP payload. Live DON is not required. This environment has no CRE tenant: `CRE_API_KEY` unset, `cre login` needs a browser, public `ci.yml` has no secrets. Official `cre workflow build` already compiled this courier; simulate still exits 1 at PersistentPreRun (`simulation/cre-workflow-simulate.cli.txt`, `compiled=false`). Unstick: founder supplies `CRE_API_KEY` (or an interactive `cre login`) and re-run `cre workflow simulate maintenance-courier --target staging-settings --non-interactive --trigger-index 0 --http-payload @simulation/signed-job-http-payload.json` from `ops/cre`. See `simulation/cre-tenant-blocker.json`. |
| Autonomous non-interactive execution + failover | **Yes (Anvil 5042002)** | `scripts/autonomous-relay-failover.ts` + `simulation/autonomous-relay-failover.json`. A/B start together; A submit down; B consumes. Race: one `JobConsumed` + one `Replay` |
| Live CRE DON on Arc Testnet 1883 | **No — not claimed** | No tenant, no explorer hash, no invented 1883 Gateway |
| CRE production write on Arc Mainnet 5042 | **No — hard blocked** | Not listed; repo disables 5042 |
| Post-merge `Guardian.keeper == AutomationGateway` | **After merge** | `Deploy.s.sol` `_installGateway`. Committed `deployments/local.json` is the pre-gateway dump — do not invent addresses |

## Arc Mainnet CRE production-write status

- This repository **hard-disables Arc Mainnet (5042)**. Do not deploy.
- Chainlink CRE’s published **mainnet** list (as of this pass) includes many L2s and L1s. **It does not list Arc Mainnet.**
- Therefore: **CRE production writes to this repo’s Arc Mainnet 5042 are not available, not configured, and not claimed.**

## Failover rehearsal (local forge — real execution)

`scripts/maintenance-failover.ts` is a **non-interactive** path (no AI in the loop). It runs `MaintenanceFailover.t.sol` against Foundry to prove **onchain** first-valid-consume:

1. Seed a flywheel USDC pot.
2. Sign one `settleQuote` `MaintenanceJob`.
3. Relayer A submits — consume succeeds; pot moves; `usedJob` is set.
4. Relayer B submits the **identical** job + signature — `Replay`; pot unchanged.

That is an onchain first-valid-consume proof, not an encode-only JSON dump. Recorded evidence: `ops/cre/simulation/failover-rehearsal.json` (`kind: local-forge-execution`). Calldata identity vs the CRE workflow is a sidecar: `failover-calldata-identity.json`.

This is **not** a live CRE DON, **not** Arc Testnet EIP-155 1883, and **not** Arc Mainnet 5042.

## Autonomous managed-relay path (deployed Gateway)

`scripts/autonomous-relay-failover.ts` is the production-shaped loop #51 asked for (still non-interactive, no AI):

1. Deploy `AutomationGateway` via `Deploy.s.sol` to a live RPC (default: local Anvil 5042002).
2. Canonical signer service (`ROLE=signer`) reads `settleTake`, signs EIP-712 `MaintenanceJob`s, and **does not broadcast**.
3. **Failover liveness:** A and B start together on the same signed job. A’s `SUBMIT_RPC` is down (real submit failure before consume). B consumes. The orchestrator does **not** wait for A=`consumed` before starting B.
4. **Race idempotency:** A and B start simultaneously against a second signed job. Exactly one `JobConsumed`; the other is `Replay`.

Evidence (tx / receipt / `JobConsumed` / `Replay`): `ops/cre/simulation/autonomous-relay-failover.json`. Committed `deployments/local.json` is restored after deploy so this rehearsal does not invent claimed addresses.

Not a live CRE DON. Not a claimed Arc Public Testnet Factory/Gateway. Not 5042. When a funded `ARC_TESTNET_PK` and a real testnet Gateway exist, point `GATEWAY_RPC` + `AUTONOMOUS_RELAY_DEPLOY` at them — do not invent explorer hashes before that.

The generic indexer unit suite (`pnpm --filter indexer test`) does **not** spawn `forge` or `anvil`. Both proofs run on `.github/workflows/ci.yml` after #73 (full/main `solidity + size-guard`; Foundry contracts also in `foundry-targeted` `forge test`).

```bash
npx --yes tsx packages/reactor/src/maintenance-job.test.ts
# pin-check committed CRE evidence / tenant-blocker (not a CRE simulate PoC)
pnpm exec tsx scripts/cre-workflow-simulate.ts --verify
# requires Foundry — also CI full/main solidity + size-guard
npx --yes tsx scripts/maintenance-failover.ts
# equivalent:
# cd contracts && forge test --match-contract MaintenanceFailover -vv
# deployed Gateway + signer HTTP + two relayer processes (requires anvil):
REQUIRE_ANVIL=1 npx --yes tsx scripts/autonomous-relay-failover.ts
# official Chainlink WASM compile (offline; no tenant):
#   cd ops/cre && cre workflow build maintenance-courier --target staging-settings
# official Chainlink simulator (requires `cre login` or CRE_API_KEY):
#   cd ops/cre && cre workflow simulate maintenance-courier --target staging-settings \
#     --non-interactive --trigger-index 0 \
#     --http-payload @simulation/signed-job-http-payload.json
```
