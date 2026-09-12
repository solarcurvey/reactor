import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { admit, issueReceipt, verifyReceipt } from "./admission.ts";
import { evaluateAdmission } from "../../../packages/reactor/src/admission.ts";

function assertInternalOrReceipt(opts: { receipt?: string; remoteAddress?: string }) {
  if (!opts.receipt) return { ok: false as const, error: "SIGNER_REQUIRES_ADMISSION" };
  const parsed = verifyReceipt(opts.receipt);
  if (!parsed) return { ok: false as const, error: "INVALID_ADMISSION_RECEIPT" };
  return { ok: true as const };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const deny = evaluateAdmission({ ticker: "", turnstileOk: true }, "NORMAL");
  assert(deny.decision === "DENY", "empty ticker DENY");
  const challenge = evaluateAdmission(
    { ticker: "CAT", turnstileOk: false, turnstileRequired: true, metadata: { name: "Cat" } },
    "NORMAL",
  );
  assert(challenge.decision === "CHALLENGE", "missing turnstile is CHALLENGE not ALLOW");
  assert(challenge.decision !== "ALLOW", "CHALLENGE ≠ ALLOW");
  const allow = evaluateAdmission(
    { ticker: "CAT", turnstileOk: true, metadata: { name: "Cat" }, quote: "0x0000000000000000000000000000000000000001" },
    "NORMAL",
  );
  assert(allow.decision === "ALLOW", "clean signals ALLOW");
}

{
  const bypass = assertInternalOrReceipt({ remoteAddress: "127.0.0.1" });
  assert(!bypass.ok && bypass.error === "SIGNER_REQUIRES_ADMISSION", "direct signer without receipt fails");
}

process.env.REACTOR_ENV = "LOCAL";
process.env.ADMISSION_HMAC_SECRET = "test-admission-hmac-secret";
delete process.env.TURNSTILE_SECRET;

{
  const issued = issueReceipt({ decision: "ALLOW", ticker: "CAT", creator: "0xabc", quote: "0x1" });
  const parsed = verifyReceipt(issued.receipt);
  assert(parsed?.ticker === "CAT", "receipt verifies");
  const bad = verifyReceipt(`${issued.receipt}x`);
  assert(bad === null, "tampered receipt fails");
  const ok = assertInternalOrReceipt({ receipt: issued.receipt, remoteAddress: "127.0.0.1" });
  assert(ok.ok, "receipt authorizes signer");
}

const dir = mkdtempSync(join(tmpdir(), "reactor-admit-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });

{
  const allow = await admit(store, {
    ticker: "MOON",
    quote: "0x0000000000000000000000000000000000000001",
    name: "Moon",
    wallet: "0x1111111111111111111111111111111111111111",
    ip: "10.0.0.1",
  });
  assert(allow.decision === "ALLOW" && allow.receipt, `local admit ALLOW ${allow.decision} ${allow.reasons}`);
}

{
  process.env.TURNSTILE_REQUIRED = "1";
  const ch = await admit(store, {
    ticker: "SUN",
    quote: "0x0000000000000000000000000000000000000001",
    name: "Sun",
    wallet: "0x2222222222222222222222222222222222222222",
    ip: "10.0.0.2",
  });
  delete process.env.TURNSTILE_REQUIRED;
  assert(ch.decision === "CHALLENGE", `CHALLENGE without token ${ch.decision} ${ch.reasons}`);
  assert(!ch.receipt, "no receipt on CHALLENGE");
}

{
  process.env.ISSUANCE_LEVEL = "ATTACK";
  const first = await admit(store, {
    ticker: "ATT1",
    quote: "0x0000000000000000000000000000000000000001",
    name: "Attack",
    wallet: "0x3333333333333333333333333333333333333333",
    ip: "10.0.0.3",
  });
  const second = await admit(store, {
    ticker: "ATT2",
    quote: "0x0000000000000000000000000000000000000001",
    name: "Attack2",
    wallet: "0x3333333333333333333333333333333333333333",
    ip: "10.0.0.3",
  });
  delete process.env.ISSUANCE_LEVEL;
  assert(first.decision !== "ALLOW" || second.decision !== "ALLOW", "ATTACK throttle durable");
}

{
  const wallet = "0x4444444444444444444444444444444444444444";
  let last = "ALLOW";
  for (let i = 0; i < 12; i++) {
    const r = await admit(store, {
      ticker: `T${i}`,
      quote: "0x0000000000000000000000000000000000000001",
      name: `Tok${i}`,
      wallet,
      ip: "10.1.2.3",
    });
    last = r.decision;
  }
  assert(last === "CHALLENGE" || last === "DENY", `wallet throttle last=${last}`);
}

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("admission tests ok");
