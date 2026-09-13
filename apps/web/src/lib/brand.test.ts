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
assert(
  !/launch markets that pay holders/i.test(BRAND_COPY.description),
  "description must not imply every launch pays holders",
);
assert(
  /Rewards pay holders/.test(BRAND_COPY.description) &&
    /Standard burns/.test(BRAND_COPY.description),
  "description distinguishes Rewards vs Standard",
);
assert(
  !/pay holders/i.test(BRAND_COPY.ogDescription),
  "OG stays mode-neutral and must not say pay holders",
);

const restricted = readFileSync(
  fileURLToPath(new URL("../app/restricted/restricted-view.tsx", import.meta.url)),
  "utf8",
);
assert(restricted.includes("rx-kicker"), "/restricted kicker uses approved-C heat");
assert(!/text-cyan|cyan-\d+|rounded-full/.test(restricted), "/restricted must not keep Direction A cyan or pill links");

const errorFallback = readFileSync(
  fileURLToPath(new URL("../components/error-fallback.tsx", import.meta.url)),
  "utf8",
);
assert(errorFallback.includes("rx-kicker"), "#46 error boundary kicker uses approved-C heat");
assert(
  !/text-cyan|cyan-\d+|rounded-full|#7ee8ff|text-zinc-500/.test(errorFallback),
  "#46 error fallback must not keep Direction A cyan or sub-AA zinc-500",
);
const supportRef = readFileSync(
  fileURLToPath(new URL("../components/support-ref.tsx", import.meta.url)),
  "utf8",
);
assert(!/text-zinc-500/.test(supportRef), "SupportRef uses the AA muted floor");

const globalError = readFileSync(fileURLToPath(new URL("../app/global-error.tsx", import.meta.url)), "utf8");
assert(globalError.includes("#ff6b2b"), "#46 global-error uses heat");
assert(globalError.includes("#12110f"), "#46 global-error uses slag");
assert(
  !/#7ee8ff|borderRadius:\s*999/.test(globalError),
  "#46 global-error must not keep cyan pills",
);

const layout = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
assert(layout.includes("BRAND_COPY.description"), "layout uses canonical description");
assert(layout.includes("releaseInfo"), "layout keeps #46 release SHA");
assert(layout.includes("data-release"), "footer exposes release SHA");
const ogBlock = layout.slice(layout.indexOf("openGraph:"), layout.indexOf("twitter:"));
const twitterBlock = layout.slice(layout.indexOf("twitter:"), layout.indexOf("other:"));
assert(ogBlock.includes("BRAND_COPY.ogDescription"), "OG stays on the AI-free field");
assert(twitterBlock.includes("BRAND_COPY.ogDescription"), "twitter uses OG copy");
assert(!twitterBlock.includes("BRAND_COPY.description"), "twitter must not reuse the AI metadata line");

console.log("brand voice ok");
