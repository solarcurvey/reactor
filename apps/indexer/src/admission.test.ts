import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import {
  admit,
  consumeReceipt,
  issueReceipt,
  persistReceipt,
  verifyReceipt,
  computeLaunchConfigHash,
  fundingCluster,
  networkCluster,
} from "./admission.ts";
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

{
  const a = fundingCluster("0x1111111111111111111111111111111111111111", "AS1", "10.1.2.3");
  const b = fundingCluster("0x2222222222222222222222222222222222222222", "AS1", "10.1.9.9", "0xabc");
  const c = fundingCluster("0x3333333333333333333333333333333333333333", "AS1", "10.1.9.9", "0xabc");
  assert(b === c, "same onchain funder clusters together");
  assert(a !== b, "wallet-only cluster ≠ funder cluster");
  assert(networkCluster("AS1", "10.1.2.3") === networkCluster("AS1", "10.1.8.8"), "/16 network rename");
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
    factory: "0x0000000000000000000000000000000000000002",
    mode: "rewards",
  });
  assert(allow.decision === "ALLOW" && allow.receipt, `local admit ALLOW ${allow.decision} ${allow.reasons}`);
  assert(allow.launchConfigHash, "ALLOW receipt includes launchConfigHash");
  const expected = computeLaunchConfigHash(
    {
      ticker: "MOON",
      quote: "0x0000000000000000000000000000000000000001",
      name: "Moon",
      wallet: "0x1111111111111111111111111111111111111111",
      factory: "0x0000000000000000000000000000000000000002",
      mode: "rewards",
    },
    "MOON",
  );
  assert(allow.launchConfigHash === expected, "launchConfigHash binds identity");
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
  process.env.ISSUANCE_LEVEL = "ELEVATED";
  process.env.TURNSTILE_REQUIRED = "1";
  const unsolved = await admit(store, {
    ticker: "ELV1",
    quote: "0x0000000000000000000000000000000000000001",
    name: "Elevated",
    wallet: "0x5555555555555555555555555555555555555555",
    ip: "10.0.0.5",
  });
  delete process.env.TURNSTILE_REQUIRED;
  const solved = evaluateAdmission(
    {
      ticker: "ELV1",
      turnstileOk: true,
      metadata: { name: "Elevated" },
      quote: "0x0000000000000000000000000000000000000001",
      issuanceTokens: 10,
    },
    "ELEVATED",
  );
  delete process.env.ISSUANCE_LEVEL;
  assert(unsolved.decision === "CHALLENGE", "ELEVATED unsolved CHALLENGE");
  assert(solved.decision === "ALLOW", "ELEVATED solved ALLOW under limits");
}

{
  process.env.ISSUANCE_LEVEL = "ATTACK";
  const first = evaluateAdmission(
    {
      ticker: "ATT1",
      turnstileOk: true,
      metadata: { name: "Attack" },
      quote: "0x0000000000000000000000000000000000000001",
      issuanceTokens: 5,
      recentSignedAuths: 0,
    },
    "ATTACK",
  );
  delete process.env.ISSUANCE_LEVEL;
  assert(first.decision === "ALLOW", "ATTACK solved challenge can ALLOW under limits");
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

{
  const issued = issueReceipt({ decision: "ALLOW", ticker: "CON", creator: "0x1" });
  await persistReceipt(store, issued, { ticker: "CON" }, Math.floor(Date.now() / 1000) + 300);
  const [a, b] = await Promise.all([consumeReceipt(store, issued.id), consumeReceipt(store, issued.id)]);
  assert((a && !b) || (!a && b), `atomic consume one-winner a=${a} b=${b}`);
  const third = await consumeReceipt(store, issued.id);
  assert(!third, "already consumed stays false");
}

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("admission tests ok");
