/**
 * P0: isolated signer fail-closed when the durable store is unavailable.
 * Must not skip receipt consume or the signed-auth issuance bucket.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore, type Store } from "./db.ts";
import { consumeReceipt, issueReceipt, persistReceipt } from "./admission.ts";
import {
  SIGNER_STORE_UNAVAILABLE,
  consumeDurableAdmission,
  openSignerStore,
  requireDurableStore,
  signAuthorized,
  signerHttpStatus,
} from "./launch-signer.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn: () => unknown, re: RegExp, msg: string) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = re.test(e instanceof Error ? e.message : String(e));
    if (!threw) throw new Error(`${msg}: unexpected ${e}`);
  }
  if (!threw) throw new Error(msg);
}

async function assertRejects(fn: () => Promise<unknown>, re: RegExp, msg: string) {
  let threw = false;
  try {
    const out = await fn();
    throw new Error(`${msg}: resolved ${JSON.stringify(out)}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(`${msg}: resolved`)) throw e;
    threw = re.test(e instanceof Error ? e.message : String(e));
    if (!threw) throw new Error(`${msg}: unexpected ${e}`);
  }
  if (!threw) throw new Error(msg);
}

function explodingStore(): Store {
  const boom = async () => {
    throw new Error("db down");
  };
  return new Proxy(
    { dialect: "sqlite" as const },
    {
      get(target, prop) {
        if (prop === "dialect") return target.dialect;
        if (prop === "then") return undefined;
        return boom;
      },
    },
  ) as Store;
}

process.env.REACTOR_ENV = "LOCAL";
process.env.ADMISSION_HMAC_SECRET = "test-admission-hmac-secret";

{
  const src = readFileSync(new URL("./pricing-signer.ts", import.meta.url), "utf8");
  assert(!src.includes(".catch(() => undefined)"), "pricing-signer must not swallow openStore failure");
  assert(src.includes("openSignerStore"), "pricing-signer must open store via fail-closed helper");
  assert(src.includes("durableStore()"), "pricing-signer must require durable store before sign");
}

{
  assertThrows(() => requireDurableStore(undefined), /SIGNER_STORE_UNAVAILABLE/, "undefined store fails closed");
  assertThrows(() => requireDurableStore(null), /SIGNER_STORE_UNAVAILABLE/, "null store fails closed");
}

{
  assert(signerHttpStatus(new Error(SIGNER_STORE_UNAVAILABLE)) === 503, "store unavailable is 503");
  assert(signerHttpStatus(new Error("PRICING_SIGNER_UNAVAILABLE")) === 503, "missing key is 503");
  assert(signerHttpStatus(new Error("SIGNER_REQUIRES_ADMISSION")) === 403, "missing receipt is 403");
  assert(signerHttpStatus(new Error("ADMISSION_RECEIPT_CONSUMED")) === 403, "replay is 403");
  assert(signerHttpStatus(new Error("LAUNCH_ISSUANCE_THROTTLED")) === 403, "bucket is 403");
  assert(signerHttpStatus(new Error("cannot price quote — valuation unavailable, launch disabled")) === 503, "valuation is 503");
}

await assertRejects(
  () => openSignerStore(async () => {
    throw new Error("ECONNREFUSED");
  }),
  /SIGNER_STORE_UNAVAILABLE/,
  "openSignerStore does not coerce failure to undefined",
);

await assertRejects(
  () => openSignerStore(async () => undefined as unknown as Store),
  /SIGNER_STORE_UNAVAILABLE/,
  "openSignerStore rejects empty store",
);

{
  const issued = issueReceipt({
    decision: "ALLOW",
    ticker: "CAT",
    creator: "0x1111111111111111111111111111111111111111",
    quote: "0x0000000000000000000000000000000000000001",
  });
  let signed: unknown = "not-thrown";
  try {
    signed = await signAuthorized(undefined, { ticker: "CAT", receipt: issued.receipt }, { receipt: issued.receipt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(msg.includes(SIGNER_STORE_UNAVAILABLE), `expected store unavailable, got ${msg}`);
    assert(!msg.includes("0x") || msg.includes(SIGNER_STORE_UNAVAILABLE), "must not return a signature");
    signed = undefined;
  }
  assert(signed === undefined, "signAuthorized without store must not produce a LaunchAuthorization");
}

await assertRejects(
  () => consumeDurableAdmission(explodingStore(), { id: "dead", decision: "ALLOW" }),
  /db down/,
  "store errors during consume fail closed",
);

await assertRejects(
  () => consumeDurableAdmission({} as Store, { decision: "ALLOW" }),
  /INVALID_ADMISSION_RECEIPT/,
  "receipt without durable id cannot skip consume",
);

const dir = mkdtempSync(join(tmpdir(), "reactor-signer-store-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });

{
  const issued = issueReceipt({ decision: "ALLOW", ticker: "DOG", creator: "0x1" });
  await persistReceipt(store, issued, { ticker: "DOG" }, Math.floor(Date.now() / 1000) + 300);
  await consumeDurableAdmission(store, { id: issued.id, decision: "ALLOW" });
  const replay = await consumeReceipt(store, issued.id);
  assert(!replay, "durable consume marks receipt used");
  await assertRejects(
    () => consumeDurableAdmission(store, { id: issued.id, decision: "ALLOW" }),
    /ADMISSION_RECEIPT_CONSUMED/,
    "second consume fails closed",
  );
}

{
  const issued = issueReceipt({ decision: "ALLOW", ticker: "ELK", creator: "0x2" });
  await persistReceipt(store, issued, { ticker: "ELK" }, Math.floor(Date.now() / 1000) + 300);
  await assertRejects(
    () => signAuthorized(explodingStore(), { ticker: "ELK", receipt: issued.receipt }, { receipt: issued.receipt }),
    /db down/,
    "signAuthorized does not skip consume when store throws",
  );
}

await store.close();
rmSync(dir, { recursive: true, force: true });

{
  const here = dirname(fileURLToPath(import.meta.url));
  assert(here.endsWith("src"), "test lives next to pricing-signer");
}

console.log("pricing-signer store fail-closed tests ok");
