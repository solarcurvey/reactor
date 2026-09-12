# Media uploads

`POST /upload` on the indexer.

- Stream cap **2MB** — the request is destroyed if the body exceeds the limit.
- Magic-byte type check (JPEG / PNG / WebP / GIF) and dimension bounds.
- **sharp is required** (`import sharp from "sharp"`). Images are rotated, cover-resized to 512², encoded WebP.
- Local disk store plus optional R2/S3.
- Remote PUT is **AWS SigV4** (`s3-sigv4.ts`). Not an unsigned `fetch`.
- **PROD** fail-closed if `R2_*` / `S3_*` endpoint, bucket, or keys are missing.

No base64 onchain. The launch form posts the file and stores the returned URL.
