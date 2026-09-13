# Security model

> Guardian is a brake pedal, not a steering wheel. Keeper is designated maintenance, not an owner. Not an audit.

There is no Ownable, admin, proxy admin, upgrader, governor, or treasury owner after genesis. Every privileged function is **GUARDIAN** or **KEEPER** only. Source: `GUARDIAN_MODEL.md`, `KEEPER_MODEL.md`, `PRIVILEGE_MAP.md`, `THREAT_MODEL.md`.

## Actors

| Actor | Intent / blast radius |
| --- | --- |
| Honest trader / launcher / bidder | Use the product |
| MEV searcher | Sandwich, JIT, backrun buyback |
| Malicious creator | Reclaim LP, hidden mint, tax, exclude holders — token surface forbids these |
| Malicious hook caller | Charge unofficial pools, steal deltas — hook only charges `officialPool` |
| Compromised Guardian | Halt launches/trading/Keeper; quarantine quotes; disable adapters. **Cannot** withdraw LP or redirect pots |
| Compromised Keeper | Waste a pot on a bad route/`minOut` within hop/bucket bounds. **Cannot** config, withdraw, or change fees |
| Overlapping Keepers | Mitigated by renew + fence; residual TOCTOU between last renew and RPC send |
| PoolManager (Uniswap) | Trusted v4 singleton; BUSL; not our code |

## Guardian MUST NEVER

- Withdraw any vault or official LP
- Redirect holder rewards, SelfBurn, Top-10, or CORE
- Change the 3.5% fee or the 2 / 1 / 0.5 split
- Flip Standard ↔ Rewards
- Change a token’s quote or curve constants
- Mint, seize, or blacklist
- Alter Fair claims
- Set Top-10 members or weights
- Make CORE a Top-10 member
- Set USD prices used for ranking
- Supply arbitrary swap routes as Guardian
- Alter burn recipients
- Receive fee exemption as a wallet
- Upgrade implementations
- Arbitrary-call into vaults

`GuardianP0Test` enumerates privileged entrypoints and proves these absences. **Deployer ≠ Guardian.** After genesis the deployer EOA has no protocol role.

## Keeper MUST NEVER

- Configure quotes, adapters, fees, or Guardian
- Withdraw
- Spend holder Rewards or another token’s SelfBurn
- Use `minOut` 0 or 1 on maintenance
- Broadcast after a lost leadership fence
- Run on chain **5042**

Fee exemption is only via sealed executor contracts calling `protocolSwap` / `buyExempt`. The Keeper EOA is never allowlisted. There is no bounty and no `KeeperReserve`.

## Controls (short)

1. No owner mint / pause / blacklist / tax on `ReactorToken`.
2. No LP withdraw on the vault.
3. Hook only charges `officialPool`. Initialize gated to factory + 0% fee + registered quote.
4. Fee always quote via specified/unspecified split.
5. Rewards O(1); debt synced on every transfer; excluded set immutable.
6. `protocolExempt` latch is router-scoped and `nonReentrant`. User `swap` is forbidden while the latch is set.
7. usdPegOne-only $1. EURC is not $1.
8. Launch auth digest is unique. Replay is `TickerRegistry.usedAuthorization[digest]`.
9. External USD marks are offchain multi-source consensus. PROD never falls back to a static dollar.
10. One-time binds are Guardian-only + freeze, not first-caller-wins. EOA `completeGenesis` uses a **transient** `isGuardian(address(auth))` window that **seals**; post-seal binds are EOA/Safe only. Safe MultiSend unchanged. See [EOA genesis](/docs/eoa-genesis).
11. Exact-in + nonzero minOut + incomplete-fill revert on the router.
12. Public JSON POSTs stream-cap at 16KiB / 64KiB.

## Residual risks (highest first)

1. **Hook custom accounting** — wrong sign on `BeforeSwapDelta` / afterSwap unspecified delta can steal from swappers or insolvent the hook.
2. **Reward solvency** — leftover magnified remainder is unassigned carry-forward. Last claimer can still be short dust. **Not production-invariant-complete.**
3. **CREATE2 hook bits** — a mis-mined address silently skips callbacks (0% charged) or enables extra callbacks.
4. **Single-sided launch price** — extreme FDV vs 1e9 supply can clamp to TickMath edges.
5. **Buyback sandwich** — operational Keeper key + quote-to-exec latency despite `minTargetOut`.
6. **v4-core BUSL / unaudited REACTOR** — legal + quality. No audit claim.
7. **Arc dual-decimal USDC** — mixing gas-18 with ERC-20-6 by 1e12.
8. **Keeper split-brain** — residual process pause after renew, then send. Not an on-chain fence.
9. **Indexer lag** — post-commit 24h roll / external marks / SSE / bounded `totalSupply()` reconcile can still lag.
10. **Offchain Top-10 / VWAP bugs** — fail-closed only when a **material** candidate is unvalued.

## Forbidden to everyone

Withdraw official LP. Mint after construct. Change 2/1/0.5. Redirect CORE. Blacklist. Upgrade. Wallet fee-exemption. Dead-address CORE “burn”. First-caller bind.

See [Trust](/docs/trust), [Guardian](/docs/guardian), [Keeper](/docs/keeper), `AUDIT_HANDOFF.md`.
