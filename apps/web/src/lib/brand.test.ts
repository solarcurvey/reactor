import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BRAND_AI_DISAMBIGUATION,
  BRAND_COPY,
  BRAND_VOICE,
} from "./brand.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const AI_WORD = /\bAI\b/;

function aiHits(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((part) => AI_WORD.test(part));
}

assert(
  BRAND_VOICE.allowedAiPhrase === BRAND_AI_DISAMBIGUATION,
  "voice exception must be the canonical disambiguation sentence",
);
assert(
  BRAND_COPY.description.endsWith(BRAND_AI_DISAMBIGUATION),
  "first-use metadata keeps the factual disambiguation",
);
assert(
  aiHits(BRAND_COPY.description).length === 1 &&
    aiHits(BRAND_COPY.description)[0] === BRAND_AI_DISAMBIGUATION,
  "description may use AI only in the allowed sentence",
);

for (const [name, text] of [
  ["title", BRAND_COPY.title],
  ["category", BRAND_COPY.category],
  ["tagline", BRAND_COPY.tagline],
  ["ogTitle", BRAND_COPY.ogTitle],
  ["ogDescription", BRAND_COPY.ogDescription],
] as const) {
  assert(!AI_WORD.test(text), `${name} must not use AI`);
}

assert(
  BRAND_VOICE.avoidInChromeAndOg.includes("AI"),
  "chrome/OG still forbid AI as a category claim",
);

const layout = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
assert(layout.includes("BRAND_COPY.description"), "layout uses canonical description");
const ogBlock = layout.slice(layout.indexOf("openGraph:"), layout.indexOf("twitter:"));
const twitterBlock = layout.slice(layout.indexOf("twitter:"), layout.indexOf("other:"));
assert(ogBlock.includes("BRAND_COPY.ogDescription"), "OG stays on the AI-free field");
assert(twitterBlock.includes("BRAND_COPY.ogDescription"), "twitter uses OG copy");
assert(!twitterBlock.includes("BRAND_COPY.description"), "twitter must not reuse the AI metadata line");

console.log("brand voice ok");
