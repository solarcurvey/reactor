# Media uploads

`POST /upload` on the indexer. Operator policy runs first (`x-reactor-wallet` + trusted geo) — a denied request never returns a stored `uri`. See [Operator policy](/docs/operator-policy).

- Stream cap **2MB** — the request is destroyed if the body exceeds the limit.
- Magic-byte type check (JPEG / PNG / WebP / GIF) and dimension bounds.
- **sharp is required** (`import sharp from "sharp"`). Not optional. The indexer calls `assertSharpWorks()` at start. Images are rotated, cover-resized to 512², encoded WebP.
- Native install: `sharp` is listed in `pnpm.onlyBuiltDependencies`. On a fresh host, if the install prompts, run `pnpm approve-builds` and allow `sharp`, then `pnpm install` again. A silent optional miss is a bug — uploads must fail closed.
- Local disk store plus optional R2/S3.
- Remote PUT is **AWS SigV4** (`s3-sigv4.ts`). Not an unsigned `fetch`.
- **PROD** fail-closed if `R2_*` / `S3_*` endpoint, bucket, or keys are missing.

## Public URL ↔ object key

`put()` returns `uri: /m/<id>.webp`. `GET /m/<id>.webp` on the indexer reads the local file `<id>.webp`.

When `MEDIA_CDN_BASE` is set, `publicUrl` is `MEDIA_CDN_BASE` + `uri` (no extra slash). The R2/S3 object key is that same path without the leading slash: **`m/<id>.webp`**. Not the bare content id. A custom-domain CDN mapped to the bucket root then serves `https://cdn…/m/<id>.webp` from the object that was uploaded.

`mediaObjectKey(id)` and `mediaPublicUri(id)` are the single source of truth. `assertMediaKeyMatchesPublicUri` refuses a remote key that would 404 behind the returned URL. The mock SigV4 fixture stores the PUT body under that key and a subsequent GET of `m/<id>.webp` must return the same bytes and `image/webp`. A PROD remote PUT failure throws and returns no `StoredMedia` (no dead public URL).

No base64 onchain. The launch form posts the file and stores the returned URL.

## Browser rendering (untrusted)

The public UI does **not** load arbitrary creator `https://` images. `sanitizeMediaUrl` allows:

- `/m/<hex>.webp` (relative)
- `/icons/<file>.{svg,webp,png,jpg,gif}` (first-party review/static)
- Absolute URLs whose **origin** is the indexer or `MEDIA_CDN_BASE` / `NEXT_PUBLIC_MEDIA_CDN_BASE` and whose path is `/m/<id>.webp`

Rejected: `javascript:`, `data:` (including SVG), `blob:`, `file:`, protocol-relative `//`, credentials in the URL, path travel, foreign CDNs. Failed images render ticker initials. `referrerPolicy=no-referrer`.

`GET /m/<id>.webp` is `image/webp` + `X-Content-Type-Options: nosniff` + `Content-Security-Policy: default-src 'none'; sandbox`.

See [Browser security](/docs/web-security).
