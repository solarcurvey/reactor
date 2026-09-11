# Factory versioning

Factories are **immutable**. Guardian authorizes and deprecates versions for **new launches only**.

This is **not** the REACTOR protocol semver. Protocol release **0.1.0** lives in `docs/version.json`. Factory **V1 stays V1 forever** even when the protocol release moves to 0.1.1 or 0.2.0. See `/docs/versioning`.

## Rules

1. Each factory address has one version number, set at `authorizeFactory(factory, version)`.
2. `deprecateFactory(factory)` blocks **new** launches on that factory. Existing tokens, curves, official pools, rewards, and vaults are untouched forever.
3. Every launch persists `factoryVersion` on the token (`ReactorFactory.tokenFactoryVersion` and `TickerRegistry.tokenFactoryVersion`).
4. V1 = this repo’s `ReactorFactory` (`FACTORY_VERSION = 1`). A different fee split or curve is a new factory deploy, not a proxy.

## What this is not

- Not an upgrade proxy
- Not a rewrite of V1 token economics
- Not a way to un-graduate or migrate official LP
