# Operator policy gate

> Offchain REACTOR-operated services only. Protocol **0.3.3**. Factory **V1**. Not a legal or OFAC-compliance opinion.

One shared server-side decision (`evaluateOperatorPolicy` in `@reactor/core`) gates services that **create, prepare, or authorize** user-facing writes. Client-side blocking is UX only. The server decision is authoritative.

This does **not** stop anyone from calling public immutable contracts directly onchain. REACTOR cannot and does not claim that.

Issue **#62** (child of RELEASE GATE **#60**). Address screening is **#61** (merged **#66** `indexerSanctionsStore().screen`). Trusted geo is **#63** (merged **#67** `evaluateRequestGeo`). Production fail-closes unless both official plugins bind.

## Decisions

| Decision | HTTP | When |
| --- | --- | --- |
| `allow` | continue | Address screen `clear` **and** trusted geo `ALLOW` |
| `deny` | **403** | Address `blocked` or geo `DENY` |
| `unavailable` | **503** (dataset/geo/plugin) or **403** (missing/invalid wallet proof) | Dataset missing/stale, geo unknown, missing/invalid recovered-wallet proof, or required plugin down |

Machine `reason` codes (stable):

- `ALLOW`
- `DENY_ADDRESS_BLOCKED`
- `DENY_GEO_BLOCKED`
- `UNAVAILABLE_DATASET_MISSING`
- `UNAVAILABLE_DATASET_STALE`
- `UNAVAILABLE_ADDRESS_SCREEN`
- `UNAVAILABLE_GEO_POLICY`
- `UNAVAILABLE_WALLET_MISSING`
- `UNAVAILABLE_WALLET_PROOF`
- `UNAVAILABLE_POLICY_REQUIRED`

User `error` is a short sentence. Responses do **not** include SDN names, list UIDs, dataset hashes, or HMAC material.

## Inputs (never from the browser alone)

| Input | Authority |
| --- | --- |
| Wallet / address screen | Server `#61` `screen()` (or LOCAL fixture). Subject is the **EIP-191 recovered signer** of a server-issued `GET /operator-policy/challenge`. `body.wallet` / `creator` / `recipient` / `x-reactor-wallet` are ignored for screening. |
| Geo | Server `#63` `evaluateRequestGeo` (verified edge HMAC) or LOCAL `x-reactor-geo-fixture`. |
| Freshness | Dataset / policy freshness from those modules. Stale or missing is never `clear` / `ALLOW`. |

Ignored (never override): `sanctionsClear`, `ofacClear`, `country`, `CF-IPCountry`, `X-Forwarded-For`, `x-sanctions-clear`, `x-reactor-wallet`, and claimed `wallet` / `creator` / `recipient` fields.

Proof: client `personal_sign`s the challenge message and sends `x-reactor-wallet-proof` (`{token,signature}`). After allow, quote `recipient` and launch `creator` are overwritten to the recovered signer so a different `msg.sender` cannot consume the artifact.

## Public status read (#65 / PR #75)

`GET /operator-policy/status` is the official minimized decision read. Same `evaluateOperatorPolicy` as writes. Optional `x-reactor-wallet-proof` screens the recovered signer. Claimed wallet / country / “clear” flags are ignored.

| Field | Notes |
| --- | --- |
| `ok` / `writesAllowed` | `true` only on `ALLOW` |
| `decision` | `allow` / `deny` / `unavailable` |
| `reason` | Same machine codes as write denials |
| `kind` | `allow` / `wallet` / `geo` / `unavailable` — coarse UX only |
| `error` | Short user sentence |
| `policy` / `disclaimer` / `source` | `reactor-operator-policy-v1` / hosted-service disclaimer / `"indexer"` |

HTTP follows the decision (`200` / `403` / `503`). Body never includes wallet, IP, country ISO, SDN names, dataset hashes, or HMAC material.

Without a proof: geo `DENY` still returns `DENY_GEO_BLOCKED`; otherwise `UNAVAILABLE_WALLET_MISSING` (not `ALLOW`). Next `GET /api/operator-policy` (#75) should call this path — not invent a second decision module. Write gates remain authoritative.

## Surfaces that enforce

| Surface | Gate runs before |
| --- | --- |
| `POST /launch/admit` | Admission decision |
| `POST /launch/authorize` | Admission + isolated signer output |
| Isolated launch signer (`:43149` POST) | `LaunchAuthorization` signature |
| `POST /api/launch-pricing` (Next BFF) | Forwards to indexer; does not honor client flags |
| `POST /quote` | Route ticket / `tx` payload |
| `POST /upload` | Stored image URI (recovered signer required) |
| Future operator signer / API that authorizes user-facing protocol actions | Must call `gateProtectedWrite` |

## Surfaces that do **not** enforce (read-only)

Cosmetic denial of public market/docs reads is out of scope.

| Surface | Notes |
| --- | --- |
| `GET /operator-policy/challenge` | Issues a short-lived HMAC challenge (not a write) |
| `GET /operator-policy/status` | Minimized public decision for #65 UX. Not a write. |
| `GET /health` | Liveness |
| `GET /markets` | Discovery board |
| `GET /ticker/:ticker` | Ticker status |
| `GET /candles/:token` | Charts |
| `GET /swaps/:token` | Tape |
| `GET /quote-assets` | Quote list |
| `GET /valuation` | Marks |
| `GET /top10` | Rank snapshot |
| `GET /pricing/health` | Provider health |
| `GET /stream` | SSE |
| `GET /m/:file` | First-party image |
| `GET /sanctions/screen` | Exact official-list lookup (#61 / #66). Not the write gate. |
| `GET /sanctions/dataset` | Active dataset version / freshness. Lookup only. |
| Next `/docs`, `/llms.txt` | Handbook |
| Onchain Factory / Router / Curve / Hook | Public; not gated |

`GET /ops` is ops-token authenticated maintenance, not a user write path.

## LOCAL vs production

- **LOCAL:** fixture address list (`OPERATOR_POLICY_BLOCKED_WALLETS`) + fixture geo (`x-reactor-geo-fixture`, deny ISOs `FX` / `FY-99` to match #63) unless a **current** `#61` dataset is loaded (`SANCTIONS_DATA_DIR`). Default geo is allow so the demo still launches. Dataset freshness: `OPERATOR_POLICY_DATASET_FRESHNESS=current\|stale\|missing`. The Next launch-pricing BFF forwards recovered-wallet proof only — it does not replay browser geo or country headers.
- **Production-like** (`REACTOR_ENV=PROD` / `STAGING` / `TESTNET` or `NODE_ENV=production`): official `#66` `sanctions.ts` binds (`indexerSanctionsStore().screen`) and official `#67` `geo-policy-resolve.ts` binds (`evaluateRequestGeo`). Fail closed unless **both** official plugins are bound. Browser country headers still ignored. `GET /sanctions/screen` remains the ungated lookup API.

See [Trust](/docs/trust), [Admission](/docs/admission), [API](/docs/api).
