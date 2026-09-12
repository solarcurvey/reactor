import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { forbiddenNeedles } from "../apps/web/src/lib/secret-sentinel.ts";

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`scan-client-bundle: missing ${dir} — run pnpm --filter web build first`);
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|css|json|html|map)$/.test(name)) acc.push(p);
  }
  return acc;
}

const staticDir = join(import.meta.dirname, "../apps/web/.next/static");
const files = walk(staticDir);
if (files.length < 3) throw new Error("scan-client-bundle: no client assets under .next/static");

const needles = forbiddenNeedles();
const hits: string[] = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const needle of needles) {
    if (text.includes(needle)) hits.push(`${file}: ${needle}`);
  }
}

if (hits.length) {
  throw new Error(`Client bundle leaked secrets:\n${hits.join("\n")}`);
}

console.log(`scan-client-bundle ok (${files.length} assets, ${needles.length} needles)`);
