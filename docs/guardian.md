# Guardian — can / cannot

The Guardian is the only privileged security authority. Immutable address (production: a Safe). Brake pedal, not steering wheel.

> Compromise can halt the product. It cannot steal official LP or rewrite the 2/1/0.5 split.

## Can

- Pause launches, Keeper, trading
- Replace Keeper
- Replace Launch Signer (isolated; ≠ Keeper ≠ Safe)
- Add / quarantine **external** quotes
- Approve adapters
- Authorize / deprecate factory versions for **new** launches
- Permanently lock a ticker (judgment, not an oracle)
- One-shot genesis binds (Batch A while paused → verify → Batch B vest + unpause)

## Cannot

- Withdraw LP
- Redirect pots
- Change 3.5% or 2/1/0.5
- Flip Standard ↔ Rewards
- Mint, seize, blacklist
- Set Top-10 membership
- Upgrade contracts
- Grant wallet fee-exemption

See `GUARDIAN_MODEL.md` and `PRIVILEGE_MAP.md`.
