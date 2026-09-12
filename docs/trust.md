# Trust assumptions (top 10)

> Protocol **0.2.0**. Not audited. Not trustless. Not mainnet.

These are the assumptions a hostile reader should price. Ranked by blast radius.

| # | Assumption | If it fails |
| --- | --- | --- |
| 1 | **Top-10 ranks are an offchain API.** Contracts check structure only. | Wrong names receive the 1% pot. |
| 2 | **Launch Signer + admission.** No signature unless `LaunchAdmissionService` returned ALLOW. Isolated process. | Spam launches / stolen tickers / signed junk identity. |
| 3 | **Guardian is the only security authority.** Pause, quarantine, signer rotate, factory deprecate. | A compromised Guardian Safe can halt launches and rotate signer. Cannot rewrite 3.5% or withdraw LP. |
| 4 | **Designated Keeper.** One lease. Simulated `minOut`. No permissionless keepers. | Stalled pots or a bad hop if the lease holder is malicious *and* simulation is fooled. |
| 5 | **ValuationService is canonical.** Nested multiply + ancestry. No parent-only USD. No silent static ZEC in prod. | Bad marks pause material Top-10 / launch pricing. Trading continues. |
| 6 | **RouteGraph stores proven pools only.** Quote simulates those edges. Never fabricates 0.30% hookless. | A missing venue is unavailable — not a dust `minOut`. |
| 7 | **Indexer is not chain.** UPSERT + uniqueness on `(chain, tx, logIndex)`. Arc finality is a confirmation depth, not Ethereum L1 finality. | Reorgs rewind ~8 blocks (`ARC_FINALITY_CONFIRMATIONS`). |
| 8 | **Uniswap v4-core BUSL.** Official PoolManager is not on Arc Testnet as of last probe. | Legal + availability. No production claim. |
| 9 | **Media / R2.** Prod fail-closed. Local disk is not a CDN. | Missing image, not a silent “uploaded”. |
| 10 | **No audit, no formal verification, no mainnet Guardian rehearsal.** | Hostile capital will try to steal or lock assets. |

See `THREAT_MODEL.md`, `AUDIT_HANDOFF.md`, [Guardian](/docs/guardian), [Keeper](/docs/keeper).
