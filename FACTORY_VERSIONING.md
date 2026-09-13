# Factory versioning

Factories are **immutable**. Guardian authorizes and deprecates versions for **new launches only**.

This is **not** the REACTOR protocol semver. Protocol release lives in `docs/version.json` (do not freeze a patch number here). Factory **V1 stays V1 forever** even when the protocol release moves. See `/docs/versioning`.

## Rules

1. Each factory address has one version number, set at `authorizeFactory(factory, version)`.
2. `deprecateFactory(factory)` blocks **new** launches on that factory. Existing tokens, curves, official pools, rewards, and vaults are untouched forever.
3. Every launch persists `factoryVersion` on the token (`ReactorFactory.tokenFactoryVersion` and `TickerRegistry.tokenFactoryVersion`).
4. V1 = this repo’s `ReactorFactory` (`FACTORY_VERSION = 1`). A different fee split or curve is a new factory deploy, not a proxy.
5. EIP-170: `ReactorFactory` runtime stays under 24,576 with a 1,024-byte CI margin. `new ReactorToken` + EIP-712 verify + official-pool open live in `InstantLaunchModule` (not a proxy). Factory still `claimOnLaunch`s and is InstantCurve’s `onlyFactory`. Guardian binds the module once (`bindLaunchModule`). Hook and liquidity vault also bind the module so official-pool init/lock are authorized.

## What this is not

- Not an upgrade proxy
- Not a rewrite of V1 token economics
- Not a way to un-graduate or migrate official LP
