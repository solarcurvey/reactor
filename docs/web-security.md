# Launchpad browser security

> Token names, tickers, descriptions, social URLs, and images are **untrusted**. The public UI never renders them as HTML. Protocol economics are unchanged.

Creators (or a hostile indexer row) can put anything in identity fields. React text nodes escape markup, but `href` / `src` are a different sink: `javascript:`, `data:`, SVG, and protocol-relative URLs must not become links or images.

## Policy

| Field | Display | Allowed as URL / media |
| --- | --- | --- |
| Name | Strip tags / bidi / controls. Cap 64. | Never a URL |
| Ticker | `A–Z0–9` only. Cap 10 | Path segment only (`/quote/ZEC`) |
| Description | Strip tags / schemes. Cap 500 | Never a URL |
| Website | Hidden unless allowlisted | `https:` (loopback `http:` only) |
| Twitter / X | Hidden unless allowlisted | `x.com` / `twitter.com` or `@handle` |
| Telegram | Hidden unless allowlisted | `t.me` / `telegram.me` or `@handle` |
| Image | Initials if rejected | First-party `/icons/…` or `/m/<id>.webp` (indexer / `MEDIA_CDN_BASE`). No `data:`, no `javascript:`, no arbitrary `https:` |

Shared implementation: `packages/reactor/src/untrusted-metadata.ts`. The web board, token page, launch form, and admission all use it.

## Admission

`evaluateAdmission` **DENYs** HTML names and off-policy image/social URLs (`name-html`, `image-url`, `website-url`, …). CHALLENGE is not a backdoor for a `javascript:` image. Empty socials and empty image are fine.

The UI still sanitizes **on read**. Frozen onchain metadata from before this policy is not trusted.

## Production headers / CSP

`apps/web/next.config.ts` sends `launchpadSecurityHeaders()`:

- `Content-Security-Policy` — `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri` / `form-action` `'self'`; `img-src` is `'self'` + indexer/CDN origins (**not** a bare `https:` wildcard); Turnstile `script-src` / `frame-src` `https://challenges.cloudflare.com`
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
- `Cross-Origin-Opener-Policy: same-origin`
- `Strict-Transport-Security` and `upgrade-insecure-requests` only when `REACTOR_ENV=PROD` (so local `next start` on http://127.0.0.1 is not forced to HTTPS)

Indexer `GET /m/<id>.webp` adds `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. Uploads remain magic-byte + sharp → WebP (no SVG, no base64 onchain).

## Tests

`packages/reactor/src/untrusted-metadata.test.ts` — XSS strings, scheme smuggling, SVG `data:`, foreign image hosts, path travel, admission DENY reasons, and a lock that `apps/web/src` has no `dangerouslySetInnerHTML` / raw `src={t.image}`.

`apps/web/src/lib/security-headers.test.ts` — CSP directives and next.config wiring.

See [Media](/docs/media), [Trust](/docs/trust), [Admission](/docs/admission), [Creators](/docs/creators).
