# FAQ

**Is this audited?** No.

**Is Top-10 trustless?** No. Offchain API + structural onchain checks.

**Do I need a signature to launch on USDC?** Yes. Every launch needs `LaunchAuthorization`.

**Can I squat a ticker by requesting a signature and not sending the tx?** No. The lock happens on successful `claimOnLaunch`.

**Can Guardian unlock a ticker?** Permanent lock is one-way. The 24h lock expires unless permanently locked.

**Is EURC $1?** No. Only explicit `usdPegOne` (initially canonical USDC).

**Where is Ops?** Off the public nav. `/ops` requires `OPS_TOKEN`.
