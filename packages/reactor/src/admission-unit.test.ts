import { evaluateAdmission, issuanceFromCounts } from "./admission.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(issuanceFromCounts(0) === "NORMAL", "normal");
assert(issuanceFromCounts(60) === "ELEVATED", "elevated");
assert(issuanceFromCounts(200) === "ATTACK", "attack");
assert(issuanceFromCounts(0, "ATTACK") === "ATTACK", "env override");

const ch = evaluateAdmission({ ticker: "X", turnstileOk: false, turnstileRequired: true, metadata: { name: "X" } }, "ELEVATED");
assert(ch.decision === "CHALLENGE" && ch.challenge === "turnstile", "elevated + no turnstile");
assert(ch.decision !== "ALLOW", "challenge is not allow");

console.log("admission unit tests ok");
