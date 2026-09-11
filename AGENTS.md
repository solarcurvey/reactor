# AGENTS

Instructions for humans and coding agents working in this repo.

## Product invariants (do not “simplify away”)

- Instant Launch is **bonding curve → locked v4 graduation**, not single-sided v4 from trade #1. Creators have no supply/FDV/fee knobs.
- Official REACTOR Pool LP fee is **0%**. The 3.5% is hook custom accounting in **quote**.
- Split is **2% holders / 1% flywheel / 0.5% CORE**. Different split = V2 deploy.
- No creator fee, platform cash fee, creation fee, transfer tax, or token-level sell tax.
- Tokens are normal ERC-20: mint once, no owner mint, no blacklist, no pause.
- Rewards are O(1), no staking, persist across transfers.
- Fair auction has **0%** REACTOR charge; 3.5% starts after one migration.
- Liquidity vault cannot withdraw. No upgrade backdoor.
- Do not deploy to Arc Mainnet (5042).
- Do not claim the product is audited.
- Do not use Marvel / Iron Man / “Arc Reactor” branding or proprietary launchpad copy.

## Engineering rules

- Security > cleverness. Proven v4 primitives > custom AMM math.
- Immutable / simple > upgradeable.
- O(1) > holder iteration.
- Onchain truth > indexer.
- Frontend mistakes are reversible; hook mistakes are not. Change the UI first.

## How to run

See `README.md`. Foundry 1.8+, Node 22+, `pnpm`.

## Touching the hook

Re-run `test/unit/HookFees.t.sol`, `test/attack/*`, and the CREATE2 bit test. Recalculate hook flags if you add a callback. Mine a new salt.

## Docs

If you change fees, exclusions, launch modes, or addresses, update `ECONOMICS.md`, `DECISIONS.md`, `AUDIT_HANDOFF.md`, and `BUILD_REPORT.md` in the same change.
