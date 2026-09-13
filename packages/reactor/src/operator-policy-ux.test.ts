import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPERATOR_POLICY_DISCLAIMER,
  OPERATOR_POLICY_ID,
  PUBLIC_POLICY_VIEW_KEYS,
  RESTRICTED_DISCLOSURE,
  RESTRICTED_PAGE_COPY,
  USER_POLICY_MESSAGES,
  allowStubView,
  copyContainsForbiddenGuidance,
  parseUxKind,
  parseWritePolicyError,
  publicPolicyView,
  publicViewHasSensitiveKeys,
  restrictedDisplayKind,
  restrictedHref,
  isWalletProofPendingReason,
  launchpadUxFromView,
  sanitizePublicPolicyView,
  unavailableStubView,
  writeCtaLabel,
  writesAllowedForReason,
  type OperatorPolicyReason,
} from "./operator-policy-ux.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ALL_REASONS = Object.keys(USER_POLICY_MESSAGES) as OperatorPolicyReason[];

{
  assert(writesAllowedForReason("ALLOW"), "allow writes");
  for (const reason of ALL_REASONS.filter((r) => r !== "ALLOW")) {
    assert(!writesAllowedForReason(reason), `${reason} must disable writes`);
  }
}

{
  const wallet = publicPolicyView({ reason: "DENY_ADDRESS_BLOCKED", source: "fixture" });
  assert(wallet.kind === "wallet", "wallet kind");
  assert(wallet.decision === "deny", "wallet deny");
  assert(wallet.writesAllowed === false, "wallet writes off");
  assert(wallet.error.includes("account"), "wallet copy names account");
  assert(!wallet.error.toLowerCase().includes("criminal"), "no accusation");

  const geo = publicPolicyView({ reason: "DENY_GEO_BLOCKED", source: "fixture" });
  assert(geo.kind === "geo", "geo kind");
  assert(geo.error.includes("location"), "geo copy names location");

  const down = publicPolicyView({ reason: "UNAVAILABLE_DATASET_STALE", source: "stub" });
  assert(down.kind === "unavailable", "stale is unavailable UX");
  assert(down.error.includes("temporarily unavailable"), "temporary copy");
}

{
  const leaked = sanitizePublicPolicyView(
    {
      ok: false,
      reason: "DENY_GEO_BLOCKED",
      decision: "deny",
      error: "ignored extra",
      ip: "203.0.113.9",
      country: "FX",
      wallet: "0x1111111111111111111111111111111111111111",
      addressScreen: { sdn: "EVIL CORP", uid: "12345", remarks: "SDN" },
      geo: { iso: "FX", asn: 64496 },
      datasetHash: "abc",
      hmac: "secret",
    },
    "indexer",
  );
  assert(leaked, "sanitized view");
  assert(leaked.kind === "geo", "kind from reason");
  assert(leaked.error === "ignored extra" || leaked.error.includes("location"), "user error kept or replaced");
  const keys = Object.keys(leaked);
  assert(keys.every((k) => (PUBLIC_POLICY_VIEW_KEYS as readonly string[]).includes(k)), `public keys only: ${keys}`);
  assert(publicViewHasSensitiveKeys(leaked as unknown as Record<string, unknown>).length === 0, "no sensitive keys");
  const json = JSON.stringify(leaked);
  assert(!json.includes("203.0.113.9"), "no raw IP");
  assert(!json.includes("EVIL CORP"), "no SDN name");
  assert(!json.includes("12345"), "no list UID");
  assert(!/FX/.test(json), "no country ISO");
}

{
  assert(sanitizePublicPolicyView({ reason: "not-a-reason" }, "indexer") === null, "unknown reason dropped");
  assert(parseWritePolicyError({ reason: "DENY_ADDRESS_BLOCKED" })?.kind === "wallet", "write-error map");
}

{
  assert(parseUxKind("geo") === "geo", "kind parse");
  assert(parseUxKind("DENY_ADDRESS_BLOCKED") === "wallet", "reason parse");
  assert(parseUxKind("vpn") === undefined, "junk kind ignored");
  assert(restrictedDisplayKind("pending", "geo") === "geo", "query kind is SSR hint while pending");
  assert(restrictedDisplayKind("wallet", "geo") === "wallet", "live policy wins over query kind");
  assert(restrictedDisplayKind("pending", "allow") === null, "allow/pending query is not a display kind");
  assert(restrictedDisplayKind("allow") === null, "allow has no restricted display kind");
  assert(restrictedHref("geo") === "/restricted?kind=geo", "geo href");
  assert(writeCtaLabel("geo", "Launch Instant") === "Unavailable here", "geo CTA");
  assert(writeCtaLabel("wallet", "Confirm buy") === "Account unavailable", "wallet CTA");
  assert(writeCtaLabel("unavailable", "Place bid") === "Temporarily unavailable", "down CTA");
  assert(writeCtaLabel("allow", "Launch Instant") === "Launch Instant", "allow CTA");
}

{
  const corpus = [
    ...Object.values(USER_POLICY_MESSAGES),
    ...Object.values(RESTRICTED_PAGE_COPY).flatMap((c) => [c.title, c.lead]),
    ...RESTRICTED_DISCLOSURE.whatExists,
    ...RESTRICTED_DISCLOSURE.whatCannot,
    OPERATOR_POLICY_DISCLAIMER,
  ].join("\n");
  assert(!copyContainsForbiddenGuidance(corpus), "no VPN/bypass/accusation copy");
  assert(corpus.includes("cannot stop anyone from reading public chain state"), "honest chain-read limit");
  assert(corpus.includes("calling immutable public contracts"), "honest onchain limit");
  assert(RESTRICTED_DISCLOSURE.whatExists.some((l) => l.includes("Wallet-list")), "discloses wallet-list control");
  assert(RESTRICTED_DISCLOSURE.whatExists.some((l) => l.includes("geographic")), "discloses geo control");
  assert(RESTRICTED_DISCLOSURE.whatExists.some((l) => l.includes("7-day SLA")), "discloses #64 freshness SLA");
  assert(RESTRICTED_DISCLOSURE.whatExists.some((l) => l.includes("never treated as clear")), "stale is not clear");
  assert(RESTRICTED_DISCLOSURE.whatExists.some((l) => l.includes("not blockchain exposure")), "not hop analytics");
}

{
  assert(allowStubView().writesAllowed, "LOCAL stub allow");
  assert(!unavailableStubView().writesAllowed, "PROD stub fail-closed");
  assert(unavailableStubView().source === "stub", "stub source");
  assert(OPERATOR_POLICY_ID === "reactor-operator-policy-v1", "policy id");
}

{
  assert(isWalletProofPendingReason("UNAVAILABLE_WALLET_MISSING"), "wallet missing is pending proof");
  assert(isWalletProofPendingReason("UNAVAILABLE_WALLET_PROOF"), "bad proof is pending proof");
  assert(!isWalletProofPendingReason("UNAVAILABLE_POLICY_REQUIRED"), "generic unavailable is not pending");
  const pending = publicPolicyView({ reason: "UNAVAILABLE_WALLET_MISSING", source: "indexer" });
  const ux = launchpadUxFromView(pending);
  assert(ux.kind === "allow" && ux.writesAllowed && ux.error === "", "pending proof is Launch Instant UX");
  const geo = launchpadUxFromView(publicPolicyView({ reason: "DENY_GEO_BLOCKED", source: "indexer" }));
  assert(geo.kind === "geo" && !geo.writesAllowed, "geo deny stays restricted");
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "operator-policy-ux.ts"), "utf8");
  assert(!/use a vpn|enable tor|how to circumvent/i.test(src), "implementation has no bypass guidance");
}

{
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
  const files = ["components/trade-panel.tsx", "app/launch/page.tsx", "app/fair/[id]/page.tsx"];
  let joined = "";
  for (const rel of files) {
    const text = readFileSync(join(webRoot, rel), "utf8");
    joined += text;
    assert(text.includes("useOperatedWrites"), `${rel} gates writes through operated-writes`);
  }
  assert(joined.includes("policyBlocked"), "submit paths check policyBlocked");
  assert(!/vpn|circumvent|use a proxy/i.test(joined), "write surfaces have no bypass guidance");
}

{
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
  const page = readFileSync(join(webRoot, "app/restricted/page.tsx"), "utf8");
  const view = readFileSync(join(webRoot, "app/restricted/restricted-view.tsx"), "utf8");
  assert(!page.includes("useSearchParams"), "restricted page is a server entry — no useSearchParams");
  assert(!view.includes("useSearchParams"), "restricted view does not call useSearchParams");
  assert(page.includes("searchParams"), "server reads request kind");
  assert(page.includes("force-dynamic"), "restricted page is not a static searchParams shell");
  assert(view.includes("initialKind"), "client hydrates the server kind prop");
  const provider = readFileSync(join(webRoot, "components/operator-policy-provider.tsx"), "utf8");
  assert(provider.includes("hydrated"), "provider delays policy refresh until after mount");
  assert(provider.includes("if (!ready)"), "useOperatorPolicy stays pending until the consumer mounted");
}

console.log("operator-policy-ux ok");
