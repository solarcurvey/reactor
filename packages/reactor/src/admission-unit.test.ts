import { evaluateAdmission, issuanceFromCounts, ISSUANCE_CAP } from "./admission.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(issuanceFromCounts(0) === "NORMAL", "normal");
assert(issuanceFromCounts(60) === "ELEVATED", "elevated");
assert(issuanceFromCounts(200) === "ATTACK", "attack");
assert(issuanceFromCounts(0, "ATTACK") === "ATTACK", "env override");

const ch = evaluateAdmission(
  { ticker: "X", turnstileOk: false, turnstileRequired: true, metadata: { name: "X" } },
  "ELEVATED",
);
assert(ch.decision === "CHALLENGE" && ch.challenge === "turnstile", "elevated + no turnstile");
assert(ch.decision !== "ALLOW", "challenge is not allow");

type Case = {
  name: string;
  level: "NORMAL" | "ELEVATED" | "ATTACK";
  signals: Parameters<typeof evaluateAdmission>[0];
  expect: "ALLOW" | "CHALLENGE" | "DENY";
};

const table: Case[] = [
  {
    name: "NORMAL + turnstile ALLOW",
    level: "NORMAL",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat" },
      quote: "0x0000000000000000000000000000000000000001",
    },
    expect: "ALLOW",
  },
  {
    name: "NORMAL missing turnstile when required",
    level: "NORMAL",
    signals: { ticker: "CAT", turnstileOk: false, turnstileRequired: true, metadata: { name: "Cat" } },
    expect: "CHALLENGE",
  },
  {
    name: "ELEVATED unsolved CHALLENGE",
    level: "ELEVATED",
    signals: { ticker: "CAT", turnstileOk: false, metadata: { name: "Cat" } },
    expect: "CHALLENGE",
  },
  {
    name: "ELEVATED solved ALLOW under limits",
    level: "ELEVATED",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat" },
      quote: "0x0000000000000000000000000000000000000001",
      walletHits: 1,
      ipHits: 1,
      issuanceTokens: 10,
    },
    expect: "ALLOW",
  },
  {
    name: "ELEVATED solved still rate-limited",
    level: "ELEVATED",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat" },
      walletHits: 9,
    },
    expect: "CHALLENGE",
  },
  {
    name: "ATTACK solved ALLOW under limits",
    level: "ATTACK",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat" },
      quote: "0x0000000000000000000000000000000000000001",
      walletHits: 0,
      ipHits: 0,
      sessionHits: 0,
      recentSignedAuths: 0,
      issuanceTokens: 3,
    },
    expect: "ALLOW",
  },
  {
    name: "ATTACK unsolved CHALLENGE not infinite DENY",
    level: "ATTACK",
    signals: { ticker: "CAT", turnstileOk: false, metadata: { name: "Cat" }, issuanceTokens: 3 },
    expect: "CHALLENGE",
  },
  {
    name: "ATTACK bucket empty DENY",
    level: "ATTACK",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat" },
      issuanceTokens: 0,
    },
    expect: "DENY",
  },
  {
    name: "ATTACK over signed-auth cap DENY",
    level: "ATTACK",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat" },
      recentSignedAuths: ISSUANCE_CAP.ATTACK,
      issuanceTokens: 1,
    },
    expect: "DENY",
  },
  {
    name: "empty ticker DENY",
    level: "NORMAL",
    signals: { ticker: "", turnstileOk: true },
    expect: "DENY",
  },
  {
    name: "javascript image DENY",
    level: "NORMAL",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat", image: "javascript:alert(1)" },
      quote: "0x0000000000000000000000000000000000000001",
    },
    expect: "DENY",
  },
  {
    name: "HTML name DENY",
    level: "NORMAL",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "<script>alert(1)</script>" },
      quote: "0x0000000000000000000000000000000000000001",
    },
    expect: "DENY",
  },
  {
    name: "data: SVG website DENY",
    level: "NORMAL",
    signals: {
      ticker: "CAT",
      turnstileOk: true,
      metadata: { name: "Cat", website: "data:text/html,<script>alert(1)</script>" },
      quote: "0x0000000000000000000000000000000000000001",
    },
    expect: "DENY",
  },
];

for (const row of table) {
  const got = evaluateAdmission(row.signals, row.level);
  assert(got.decision === row.expect, `${row.name}: got ${got.decision} want ${row.expect} (${got.reasons})`);
  assert(got.decision !== "ALLOW" || !got.reasons.length, `${row.name}: ALLOW has empty reasons`);
}

console.log("admission unit tests ok");
