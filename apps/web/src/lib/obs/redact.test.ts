import assert from "node:assert/strict";
import {
  containsResidualSecret,
  isSensitiveKey,
  looksLikeMnemonic,
  redactEvent,
  redactString,
  redactUnknown,
  redactUrl,
} from "./redact.ts";
import { ANVIL_ACCOUNT0_PK } from "../secret-sentinel.ts";
import { anvilMnemonic } from "./inject-sentinels.ts";

const ANVIL_PK = `0x${ANVIL_ACCOUNT0_PK}`;
const MNEMONIC = anvilMnemonic();
const SIG =
  "0x" +
  "aa".repeat(65);
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepart";

function assertNoSecret(value: unknown, label: string) {
  const s = JSON.stringify(value);
  assert.equal(s.includes(ANVIL_PK.slice(2)), false, `${label} leaked anvil pk`);
  assert.equal(s.includes(MNEMONIC), false, `${label} leaked mnemonic`);
  assert.equal(s.includes("secret-turnstile"), false, `${label} leaked turnstile`);
  assert.equal(s.includes("super-secret"), false, `${label} leaked secret`);
  assert.equal(s.includes(JWT), false, `${label} leaked jwt`);
  assert.equal(s.includes("AKIAIOSFODNN7EXAMPLE"), false, `${label} leaked aws`);
}

{
  assert.equal(isSensitiveKey("turnstile"), true);
  assert.equal(isSensitiveKey("private_key"), true);
  assert.equal(isSensitiveKey("LaunchAuthorization.signature"), true);
  assert.equal(isSensitiveKey("token"), false);
  assert.equal(looksLikeMnemonic(MNEMONIC), true);
  assert.equal(looksLikeMnemonic("Quote failed because the pool has no depth left"), false);
}

{
  const red = redactString(`pk=${ANVIL_PK} and sig=${SIG}`);
  assert.equal(red.includes(ANVIL_PK), false);
  assert.match(red, /0xac0974be…f2ff80/);
  assert.match(red, /\[redacted-sig\]/);
}

{
  assert.equal(redactString(MNEMONIC, "mnemonic"), "[redacted]");
  assert.equal(redactString(MNEMONIC), "[redacted-mnemonic]");
  const embedded = redactString(`quote inject pk=${ANVIL_PK} mnemonic=${MNEMONIC}`);
  assert.equal(embedded.includes(MNEMONIC), false, "embedded bip39 must redact");
  assert.match(embedded, /\[redacted-mnemonic\]/);
  assert.equal(redactString(`Bearer ${JWT}`).includes(JWT), false);
  assert.match(redactString(`Authorization: Bearer abc.def.ghi`), /Bearer \[redacted\]/);
  assert.match(redactString("aws AKIAIOSFODNN7EXAMPLE"), /\[redacted-aws\]/);
}

{
  const url = redactUrl("https://user:hunter2@indexer.example/launch/authorize?turnstile=secret-turnstile&token=0x4826533B4897376654Bb4d4AD88B7faFD0C98528");
  assert.equal(url.includes("hunter2"), false);
  assert.equal(url.includes("secret-turnstile"), false);
  assert.match(url, /token=0x4826533B4897376654Bb4d4AD88B7faFD0C98528/i);
}

{
  const ev = redactEvent({
    message: `Launch failed ${ANVIL_PK}`,
    extra: {
      turnstile: "secret-turnstile",
      signature: SIG,
      authorization: "Bearer super-secret",
      cookie: "ops=super-secret",
      mnemonic: MNEMONIC,
      privateKey: ANVIL_PK,
      jwt: JWT,
      quote: "ZEC",
      token: "0x4826533B4897376654Bb4d4AD88B7faFD0C98528",
    },
  });
  assertNoSecret(ev, "event");
  assert.equal((ev as { extra: { quote: string } }).extra.quote, "ZEC");
  assert.equal((ev as { extra: { turnstile: string } }).extra.turnstile, "[redacted]");
}

{
  const err = redactUnknown(new Error(`wallet ${ANVIL_PK}`)) as { message: string };
  assert.equal(err.message.includes(ANVIL_PK), false);
}

{
  assert.equal(containsResidualSecret({ message: ANVIL_PK }), true);
  assert.equal(containsResidualSecret({ message: "GET /quote 503" }), false);
}

console.log("obs/redact tests ok");
