# UI QA gate

> Visual baselines, axe + keyboard, and failure-injection against a **production `next build`**. Tokenomics unchanged. Factory **V1**. Not audited. Issue **#36 closed** after #49 post-merge `ad7b457` / [`34729758795`](https://github.com/solarcurvey/reactor/actions/runs/34729758795).

CI job `web-qa` (`.github/workflows/ci.yml`, full merge-candidate + main) runs `pnpm --filter web test:qa` → `playwright.qa.config.ts`. That config starts the shared #35 harness (`e2e/harness/start-web.mjs`: `next build` then `next start`), `e2e/harness/qa-mock.mjs` on the indexer port, and `e2e/harness/qa-rpc.mjs` on the compiled `NEXT_PUBLIC_RPC_URL` so wagmi probes do not `ERR_CONNECTION_REFUSED` (Anvil is not part of this artifact; `eth_call` fails closed and review fixtures own displayed numbers). An unexplained screenshot diff, a **serious/critical** axe violation, or an unexpected **console error / hydration warning / page exception** fails the build.

Draft PR updates and docs-only/trivial PRs stay on the cheap `test:lib` gate; add label `ci-full`, mark a **code** PR ready for review, or `workflow_dispatch` tier **full** to run `web-qa`. Do not re-add `.github/workflows/web-qa.yml` or a second `push` + `pull_request` pair. Pixel baselines stay on PR #49. GitHub billing / spending-limit reds are not a Playwright AC fail.

The shared fixture (`e2e/qa-fixture.ts`, installed from `e2e/helpers.ts`) listens on `page.on('console')` and `page.on('pageerror')` for every visual / state / a11y / failure spec. Hydration warnings never pass. `?inject=` may match only the narrow `INJECT_CONSOLE_ALLOWS` patterns for that kind (`empty` has none — empty is not an outage). Chromium `Failed to load resource` **429** on `/api/telemetry` is best-effort ingest backpressure and is **not** a blocking diagnostic (quote/indexer 429s on other URLs still fail unless that inject is active). The QA harness sets `REACTOR_TELEMETRY_RELAXED=1` so the shared-IP farm does not starve ingest. Failures attach `page-diagnostics.json` / `.txt` to the Playwright report.

```bash
pnpm --filter web test:qa
# refresh committed baselines (Linux Chromium — same as CI, against the prod artifact)
pnpm --filter web test:update-screenshots
tsx apps/web/src/lib/qa-inject.test.ts
tsx apps/web/e2e/console-gate.test.ts
tsx apps/web/e2e/contrast.test.ts
```

`NEXT_PUBLIC_REVIEW_FIXTURES=1` and `NEXT_PUBLIC_QA_INJECT=1` are compiled into this QA artifact at **build** time. A real production build omits both flags and ignores `?inject=` / `?state=`. Review-fixture OHLCV fallbacks compute `sparse` from the fixture rows (same rule as a failed indexer fetch) so token-page shots do not flip `sparse` ↔ `continuous` when `qa-mock` is up.

## Viewports

| Class | CSS size | Used for |
| --- | --- | --- |
| Desktop | 1440×900 | Primary surfaces + state/failure matrix |
| Laptop | 1280×800 | Primary surfaces |
| Compact phone | 390×844 | Primary surfaces |
| Narrow Android | 360×800 | Primary surfaces + state/failure matrix |

Axe also checks **200% zoom** (640 CSS px ≈ 1280 at 200%) and **320 CSS px** reflow.

## Production state matrix

`toHaveScreenshot` covers:

- Discover: default board, **loading**, **empty**, **search=ZCAT**, **Bonding** filter
- Launch: Instant, Fair, ticker reserved/available, Standard vs Rewards, Dev Buy, upload-ok
- Token: graduated + bonding terminals, pending / confirmed / reverted tx, confirm dialog
- Wallet account menu, live toast, quote ecosystem (`/quote/ZEC`)
- THE REACTOR, CORE, Trade, QA inject bar

Charts and the CORE mark are masked. Live/polling text is hidden.

## Accessibility

`@axe-core/playwright` runs `wcag2a` / `wcag21a` / `wcag2aa` **including `color-contrast`** on production surfaces. The only scoped excludes are unmeasurable nodes: `canvas`, `[data-visual-mask]` (OHLCV / CORE mark), and `[data-visual-dynamic]` (live ticks). Documented in `e2e/contrast.ts`. Token pairs are also pinned by `assertBrandPaletteContrast` (zinc-400 is the muted floor on `#0b0d10` / `#121418`; stock zinc-500/600 fail AA and must not be body/label copy). Axe often cannot score text on the body gradient, so `assertAxe` also runs `assertNoSubAaMutedText` and fails if any `[class]` still carries `text-zinc-500|600|700` or those placeholder variants. Extra specs:

- Dialog **focus trap** and **restore** (Account modal, confirm trade)
- **200% zoom** / 320 CSS px — no horizontal overflow, including `/restricted` and a denied operator-policy launch/token
- `/restricted` (allowed-user QA mock) plus denied geo on `/restricted`, `/launch`, and the token ticket — axe + leftover muted-class assert. Denied-state tests allow only the Chromium `403`/`503` resource log for `/api/operator-policy` (not a global console-gate weaken).
- `prefers-reduced-motion: reduce` disables pulse
- Live toasts: `role="status"` / `role="alert"` + `aria-live`; SSE reconnect uses a stable event id (no duplicate toast)

Keyboard specs cover skip-to-main, filter chips, launch quote buttons, and the buy/sell ticket.

## Failure injection (QA / review builds only)

`?inject=` and `?state=` are honored only when the QA flags were present at `next build`. Production ignores the query.

| Inject | Surface | Copy / rule |
| --- | --- | --- |
| `indexer` | Board / search / trade / token / rewards / `/reactor` | Indexer unavailable — onchain still settles |
| `rpc` | CORE stats, launch quote registry | RPC unavailable — chain 5042002 |
| `quote` | Trade ticket | Generic quote fail — no ticket, never minOut 0/1 |
| `quote-429` | Trade ticket | Rate-limited. No ticket. |
| `quote-413` | Trade ticket | Body over 16KiB / 64KiB hard max. No ticket. |
| `quote-5xx` | Trade ticket | Upstream 5xx. No ticket. |
| `quote-stale` | Trade ticket | Older than 30s — re-quote before confirm |
| `quote-expired` | Trade ticket | Ticket expired. No leftover calldata. |
| `quote-noroute` | Trade ticket | No official path. Unavailable — never minOut 0/1 |
| `pricing` | Launch | `SIGNER_STORE_UNAVAILABLE` fail-closed |
| `upload` | Launch | No StoredMedia, no base64 onchain |
| `sse` | Live toasts | Disconnect then reconnect — same event id, no duplicate UI |
| `empty` | Board / candles / tape | Zero rows. **Not** an indexer outage. |
| `token-invalid` | Token page | Address is not a factory launch |
| `ticker-invalid` | Launch | Normalize / reserve failed. 24h lock unchanged. |
| `wallet-reject` | Wallet / ticket | 4001. No transaction sent. |
| `wallet-revert` | Wallet / ticket | Submitted then reverted. Incomplete fills revert. |

`/?qa=1` (or any active inject/state) shows the failure-injection bar. **Clear** returns to the live board.

Production (no inject): a down indexer is an **error**, not an empty board. Fixtures still fill the review board when the indexer is empty.

See [Traders](/docs/traders) · [Trust](/docs/trust) · `TESTING.md` · `UX_REFERENCE.md`.
