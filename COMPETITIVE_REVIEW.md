# Competitive review (public facts only)

**Date:** 2026-09-11. Sources fetched the same day. Unverified press is labeled. **No restricted source was copied.** Licenses are recorded before any reuse discussion.

REACTOR’s V1 differentiation, used only as a comparison lens: **choose what your token earns** — official Uniswap v4 pool, **0% LP fee**, **3% quote-side hook fee** (2% holders in quote / 1% CORE burn), no creator/platform cash/creation/transfer taxes, no outside-pool tax.

---

## Archemist / Archemist V3 (not a separate “V4 suite”)

- **Source:** [archemist.fun/docs](https://archemist.fun/docs) (2026-09-11).
- **V2:** Uniswap V3 TOKEN/USDC, locker, 1% LP, 80/20 creator/protocol (owner-adjustable), 0.1 USDC deploy fee, starting FDV ~$4995, 1e9 supply. Factory/locker pair documented on that page.
- **V3:** Custom Uniswap v4 hook (`ArchemistV3Hook`). Docs describe anti-snipe, atomic creator buy, automatic ARCH buyback, locker without withdraw. Config locked at launch. Current (fifth) V3 deployment listed on Arc mainnet; vault address is one-time-set.
- **“Archemist V4”:** No confirmed separate public product named V4 beyond V3-on-v4-hooks. Treat “V4” in briefs as Uniswap v4 infrastructure, not a fourth Archemist suite.
- **Token:** Docs still state `$ARCHEMIST: NO TOKEN YET` as of fetch.
- **License:** Public docs only. **Do not copy hook/vault/routing source.** Concepts studied: hook fees, quote rewards, buyback vault safeguards, quote→USDC→platform routing.
- **Reuse:** None. Concepts only.

## UBI.fun

- No first-party docs, GitHub org, or verified contract set found under this exact name on 2026-09-11.
- **License:** unknown — **do not reuse any alleged UBI source.**
- Agent SDK / MCP mentions belong in `FUTURE.md` only.

## TOLLY

- **Source:** Odaily (community/press, 2026-09, treat as unverified unless corroborated): launchpad + DEX on Arc chain id 5042; full supply into a permanently locked USDC pool; 1% fee; buy-side USDC split described as ~64% creator / 12% holders / 10% protocol / remainder buyback-and-burn of TOLLY and project tokens; sell-side project tokens burned.
- **License:** not published in that article. **No code reuse.**
- **UX note:** chart/terminal patterns recorded in `FUTURE.md` only.

## Argus

- Public pages describe a USDC-native risk/oracle-style product in the Arc orbit. **No verified factory ABI or license** captured this pass.
- **Reuse:** none. Indexing/UX patterns only if a future license-clear source appears.

## ArcPad

- **Source:** same Odaily piece: immediate Uniswap V3 listing, 1% fee split protocol/creator by default, optional holder share; **contracts disclosed as unaudited** in that article. Circle has not endorsed it.
- **License:** unpublished here. SSE/indexer ideas → `FUTURE.md`.

## CircleWarp / Warp

- **Source:** Odaily: bonding curve, graduate ~$69k to WarpDex with LP burned; CCTP plan to burn USDC on Ethereum/Base/Arbitrum and mint on Arc. Arc-side contracts claimed deployed; source-chain contracts not live as of 2026-09-03 per that article.
- **License:** unpublished. CCTP work is **not built** (see `FUTURE.md`).

## Arcfun

- **Sources:** [arcfun.app](https://arcfun.app/), [whitepaper](https://arcfun.app/whitepaper).
- USDC bonding curve. Site: start ~$4k, graduate ~$25k, seed ~$7k LP. Whitepaper: raise $7,200 / seed $7,000 LP, 72/28 curve vs LP, no presale, full supply to curve.
- **License:** site/whitepaper; no SPDX dump fetched. **No code reuse.**

## Meme Arc

- No first-party canonical docs found this pass. **Unverified.**

## ArcPump

- **Source:** GitHub `PHUOCHAU2403/arc-pump` (MIT). README describes a later pivot to pay-per-call agent payments; earlier USDC bonding-curve launchpad left in-tree as educational/testnet.
- **License:** MIT for that repo. **Not imported.** Different product surface.

## ACTFUN

- **Source:** Mintlify docs (`actfun-761788d6.mintlify.app`). Factory `0x6b383a533DA4AAaec71d85D8e8E5bf5A2E254f2C` on Arc Testnet 5042002. Creation fee in ARC (`msg.value`). Mining + trading phases. Docs still mention ARC gas — may be stale vs USDC gas.
- **License:** docs only; no SPDX in the pages fetched. **No code reuse.**

## Minara / minara.fun

- No verified first-party technical docs or license captured this pass.

## Flutch

- No verified first-party technical docs or license captured this pass.

## PONS V2 (Robinhood Chain)

- **License first (required):** [ponsdotdev/ponsfamily](https://github.com/ponsdotdev/ponsfamily) README (fetched 2026-09-11):
  - First-party Pons contracts: **MIT**
  - `PonsTickMath.sol`: **GPL-2.0-or-later** (Uniswap V3 tick-math lineage)
  - OpenZeppelin: MIT
- Official [docs.ponsfamily.com/v2](https://docs.ponsfamily.com/v2): bonding curve → Uniswap v4 pool, liquidity locked; **three audits in progress**; **v2 mainnet addresses not published** on that page at fetch time. Bitquery’s Robinhood API page lists factory/hook addresses as a third-party index — treat as **unverified vs Pons’ own “addresses not published” statement**.
- **Reuse:** none. MIT would allow study of first-party files only after an explicit, scoped import with attribution. **Not done.** GPL tick math must not be copied into this MIT repo.

## StonkFun

- No verified first-party technical docs or license captured this pass.

---

## Differentiation (self-evident, no “first/only” claims)

| Topic | REACTOR V1 | Typical peers (public) |
| --- | --- | --- |
| Quote choice | Creator picks a **curated** quote; holders earn **that** quote | Often USDC-only |
| LP fee | **0%** | 1% LP or curve spread |
| Protocol fee | **3% quote-side hook** (2/1) on official pool only | Creator cuts, deploy fees, mining fees |
| Creator cash | **None** | Common (Tolly ~64%, ArcPad 50%, Archemist V2 80%) |
| Transfer / creation tax | **None** | Some charge create fees or transfer anti-snipe |
| Outside-pool tax | **None** | n/a |
| Fair sale | **Batch Fair Launch** (pro-rata timed, 50/50) — **not CCA** | Bonding curves or instant lock |
| CORE | TestCORE buyback+burn with protocol minOut | Platform-token buybacks (ARCH, TOLLY) |

---

## What we studied vs copied

- Archemist V3 security *concepts* (hook fees, quote rewards, vault one-time bind, routing) — **not copied**.
- UBI / ArcPad / TOLLY UX and indexer ideas — **recorded in FUTURE.md**, not built.
- PONS V2 — **license documented first**; no files imported.
