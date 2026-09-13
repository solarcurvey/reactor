#!/usr/bin/env node
/**
 * Rasterize Industrial Forge SVG sources into favicon / app / OG PNGs.
 * Vectors in apps/web/public/brand remain the source of truth.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "apps/web/public");

async function loadSharp() {
  const candidates = ["sharp", join(root, "apps/indexer/node_modules/sharp/lib/index.js")];
  for (const spec of candidates) {
    try {
      return (await import(spec)).default;
    } catch {
      /* try next */
    }
  }
  throw new Error("sharp is required. From repo root: pnpm approve-builds && pnpm install");
}

function pngIco(png32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0);
  entry.writeUInt8(32, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png32.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png32]);
}

const jobs = [
  { svg: "brand/mark.svg", out: "apple-touch-icon.png", w: 180, h: 180 },
  { svg: "brand/mark.svg", out: "icons/app-192.png", w: 192, h: 192 },
  { svg: "brand/mark.svg", out: "icons/app-512.png", w: 512, h: 512 },
  { svg: "og/default.svg", out: "og/default.png", w: 1200, h: 630 },
  { svg: "og/token-fallback.svg", out: "og/token-fallback.png", w: 1200, h: 630 },
];

const sharp = await loadSharp();
for (const job of jobs) {
  const dest = join(pub, job.out);
  mkdirSync(dirname(dest), { recursive: true });
  await sharp(readFileSync(join(pub, job.svg)))
    .resize(job.w, job.h, { fit: "fill" })
    .png()
    .toFile(dest);
  console.log("wrote", job.out);
}

const icoPng = await sharp(readFileSync(join(pub, "favicon.svg"))).resize(32, 32).png().toBuffer();
writeFileSync(join(pub, "favicon.ico"), pngIco(icoPng));
console.log("wrote favicon.ico");
