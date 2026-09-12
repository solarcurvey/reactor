# FAQ

**Is this audited?** No.

**Mainnet?** Blocked. Chain 5042 is disabled in Keeper and deploy scripts.

**Is Factory V1 the protocol version?** No. Protocol is semver (`0.3.2`). Factory V1 stays V1 forever.

**Why do I see Turnstile?** Admission. CHALLENGE is not a signature. Solve it and retry.

**Why did Fair launch revert WrongParams?** The signature must hash the resolved supply/decimals/duration/auctionBps/minRaise. Instant still uses `INSTANT_CURVE_V1`.

**Why is EURC not $1?** Only `usdPegOne` assets are. Guardian sets that flag. Category.Stablecoins is not $1.

**Why is my route unavailable?** Preview failed or `amountOut`/`minOut` is dust. The API will not ship minOut 0/1.

**Why did Arc ignore 8 confirmations?** Arc BFT is final on commit. Default lag is 0.

**Where is the Safe JSON?** `deployments/safe-genesis-builder.json`. Deployer ≠ Guardian. Fill env and regenerate.
