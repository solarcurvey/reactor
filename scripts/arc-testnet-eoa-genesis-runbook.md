# Arc testnet EOA genesis (pointer)

Canonical handbook: [`docs/eoa-genesis.md`](../docs/eoa-genesis.md) (in-app `/docs/eoa-genesis`).

After `SAFE_GENESIS=true` constructors, the immutable Guardian EOA submits `ReactorGuardian.completeGenesis` (encode with `forge script script/EoaGenesis.s.sol:EoaGenesis`). Safe MultiSend stays valid when `guardian()` is a Safe.

Do not deploy to Arc Mainnet (5042). Keep #16 open until Instant/Fair + wallet smoke exist. Refs #85.
