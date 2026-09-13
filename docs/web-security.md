# Launchpad browser security

> Token names, tickers, descriptions, social URLs, and images are **untrusted**. The public UI never renders them as HTML. Protocol economics are unchanged.

Creators (or a hostile indexer row) can put anything in identity fields. React text nodes escape markup, but `href` / `src` are a different sink: `javascript:`, `data:`, SVG, and protocol-relative URLs must not become links or images.

## Policy

| Field | Display | Allowed as URL / media |
| --- | --- | --- |
| Name | Strip tags / bidi / controls. Cap 64. `unicode-bidi: isolate` + wrap. | Never a URL |
| Ticker | `A–Z0–9` only. Cap 10 | Path segment only (`/quote/ZEC`) |
| Description | Strip tags / schemes. Cap 500. Clamp + isolate. | Never a URL |
| Website | Hidden unless allowlisted | `https:` (loopback `http:` only) |
| Twitter / X | Hidden unless allowlisted | `x.com` / `twitter.com` or `@handle` |
| Telegram | Hidden unless allowlisted | `t.me` / `telegram.me` or `@handle` |
| Image | Initials if rejected | First-party `/icons/…` or `/m/<id>.webp` (indexer / `MEDIA_CDN_BASE`). No `data:`, no `javascript:`, no arbitrary `https:` |

Shared implementation: `packages/reactor/src/untrusted-metadata.ts`. The web board, token page, launch form, and admission all use it. Display surfaces wrap identity in `UntrustedText`.

## Admission

`evaluateAdmission` **DENYs** HTML names and off-policy image/social URLs (`name-html`, `image-url`, `website-url`, …). CHALLENGE is not a backdoor for a `javascript:` image. Empty socials and empty image are fine.

The UI still sanitizes **on read**. Frozen onchain metadata from before this policy is not trusted.

## Wallet writes are not metadata

`apps/web/src/lib/tx-guard.ts` is the only resolver for wallet `to` / recipient:

- **Chain mismatch is a hard block.** `writeContract` does not run when `wallet.chainId !== deployment.chainId`. The banner is not the control — buttons disable and the guard throws `CHAIN_MISMATCH`.
- **Target** is Factory / Router / UserRoute / this market’s sanitized `token` / `curve` / `quote`. Creator `name` / `image` / `website` / socials cannot become `to`.
- **Recipient** is the connected wallet. Never a metadata string.
- **Indexer `tx.to` / `tx.data` are discarded.** The quote API may return a suggested transaction; the launchpad never broadcasts it. Calldata is built from official ABIs.
- Route hops must use allowlisted adapters (`V4Adapter` / `ProtocolV4Adapter` / `UserRouteExecutor`).

Residual: a hostile indexer can still put a well-formed but wrong **curve clone** address in the `curve` field. That is an indexer-trust issue, not a metadata XSS issue. The field must still be a 20-byte address; it is never parsed from the name.

## Production headers / CSP

Static headers (`X-Frame-Options: DENY`, nosniff, COOP, …) come from `launchpadSecurityHeaders()` in `next.config.ts`.

**CSP is not in `next.config`.** Browsers AND multiple CSPs. `apps/web/src/middleware.ts` sets a fresh `x-nonce` and `Content-Security-Policy` on every HTML/API response:

- Production `script-src`: `'self' 'nonce-…' 'strict-dynamic'` + `https://challenges.cloudflare.com`. **No `'unsafe-inline'`.** No `'unsafe-eval'`. Next.js reads `x-nonce` for its bootstrap scripts. Turnstile’s first `<script>` gets `document.documentElement.dataset.cspNonce`. `strict-dynamic` allows scripts that nonce’d script inserts.
- Production without a nonce fail-closes to `script-src 'none'`.
- Dev (`next dev`) still allows `'unsafe-inline'` + `'unsafe-eval'` for Turbopack HMR. That policy is not what production sends.
- `style-src 'self' 'unsafe-inline'` **remains**. React `style={{}}`, `next/font` injected `<style>`, and Tailwind utilities are not practical to hash per request. Risk: an HTML-injection bug could restyle the page (phishing chrome), **not** execute JavaScript. Script execution is the nonce/`strict-dynamic` policy. Replacing `style-src` would take a CSS-in-JS nonce pass we are not shipping in this V1.
- `img-src` is `'self'` + indexer/CDN origins (**not** a bare `https:` wildcard).
- HSTS / `upgrade-insecure-requests` only when `REACTOR_ENV=PROD` (local `next start` on http://127.0.0.1 is not forced to HTTPS).

Indexer `GET /m/<id>.webp` adds `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.

## Client-bundle secrets

Job-signer / Launch signer / Guardian **private keys**, Turnstile/admission HMAC secrets, R2 secrets, deployer / Arc testnet keys, and `RPC_URL_FALLBACK` / `OPS_TOKEN` are server-only. They must not appear as `NEXT_PUBLIC_*` or in `.next/static` assets. Public contract **addresses** (including Guardian and the `AutomationGateway` keeper slot on a live local deploy) are onchain identity, not secrets.

`secret-sentinel.test.ts` walks `apps/web/src`. `scripts/scan-client-bundle.ts` walks the production client assets after `next build`.

## Tests

`packages/reactor/src/untrusted-metadata.test.ts` — XSS strings, scheme smuggling, SVG `data:`, foreign image hosts, path travel, very-long / bidi / invisible caps, admission DENY reasons, and a lock that `apps/web/src` has no `dangerouslySetInnerHTML` / raw `src={t.image}` and wires `resolveTradeWrite`.

`apps/web/src/lib/security-headers.test.ts` — production `script-src` has nonce + `strict-dynamic` and no `'unsafe-inline'`; next.config does not emit a second CSP.

`apps/web/src/lib/tx-guard.test.ts` — metadata cannot become `to` / recipient; indexer `tx` discarded; chain mismatch throws.

`pnpm test:web-security` — **production** `next build` + `next start`, live response-header assertions, client-bundle sentinel, Playwright XSS corpus on home / search / token terminal / trade / reactor activity / launch toasts, and the #65 restricted-access matrix (`e2e/restricted-prod.spec.ts`: blocked wallet / geo / stale / allow on desktop + 390px, fail-closed, ignored LOCAL flags, real #62 write-gate bypass).

## Restricted access (operated services)

`/restricted` and disabled Confirm / Launch / Quote CTAs are UX over a server policy decision. Account status uses a recovered EIP-191 wallet proof, not a claimed browser wallet. The browser is not given raw IP, screening records, or list metadata. Client “clear” / country headers cannot override. This does not censor permissionless chain reads. Next reads indexer `GET /operator-policy/status` only (same `evaluateOperatorPolicy` as write gates) and never treats `/operator-policy/challenge` as a decision. Production `next start` fail-closes if `/status` is missing. Pending-proof reasons stay Launch Instant in the UI; writes still require a recovered proof at the gate. `/restricted` reads `?kind=` on the server (no `useSearchParams`) so production hydration matches. See [Restricted access](/docs/restricted-access).

See [Media](/docs/media), [Trust](/docs/trust), [Admission](/docs/admission), [Creators](/docs/creators).
