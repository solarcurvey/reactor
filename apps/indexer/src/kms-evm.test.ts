import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import {
  getAddress,
  parseSignature,
  recoverAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  KmsDigestSigner,
  SECP256K1_N,
  kmsPublicKeyToAddress,
  kmsToAccount,
  parseKmsDerSignature,
  recoverKmsDigestSignature,
  type DigestSignerBackend,
} from "./kms-evm.ts";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const local = privateKeyToAccount(PRIVATE_KEY);

function publicKeySpki(publicKey: Hex): Uint8Array {
  const raw = Buffer.from(publicKey.slice(2), "hex");
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 0x04);
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "secp256k1",
      x: raw.subarray(1, 33).toString("base64url"),
      y: raw.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  return new Uint8Array(key.export({ format: "der", type: "spki" }) as Buffer);
}

function derInteger(v: bigint): Buffer {
  let h = v.toString(16);
  if (h.length % 2) h = `0${h}`;
  let b = Buffer.from(h, "hex");
  while (b.length > 1 && b[0] === 0) b = b.subarray(1);
  if ((b[0]! & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return Buffer.concat([Buffer.from([0x02, b.length]), b]);
}

function derSignature(r: bigint, s: bigint): Uint8Array {
  const rb = derInteger(r);
  const sb = derInteger(s);
  const body = Buffer.concat([rb, sb]);
  assert.ok(body.length < 128);
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}

const spki = publicKeySpki(local.publicKey);
assert.equal(kmsPublicKeyToAddress(spki), getAddress(local.address));

const mock: DigestSignerBackend = {
  keyId: "mock-kms-key",
  async getPublicKey() {
    return spki;
  },
  async signDigest(digest) {
    const raw = await local.sign({ hash: digest });
    const parsed = parseSignature(raw);
    return derSignature(BigInt(parsed.r), BigInt(parsed.s));
  },
};

const digest = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const signer = new KmsDigestSigner(mock);
assert.equal(await signer.address(), getAddress(local.address));
const sig = await signer.signDigestParts(digest);
assert.ok(BigInt(sig.s) <= (SECP256K1_N >> 1n), "signature must be low-s normalized");
assert.equal(getAddress(await recoverAddress({ hash: digest, signature: sig })), getAddress(local.address));

const localRaw = await local.sign({ hash: digest });
const localParts = parseSignature(localRaw);
const highS = SECP256K1_N - BigInt(localParts.s);
const highDer = derSignature(BigInt(localParts.r), highS);
const parsedHigh = parseKmsDerSignature(highDer);
assert.equal(parsedHigh.sWasHigh, true);
const normalizedHigh = await recoverKmsDigestSignature(digest, highDer, local.address);
assert.ok(BigInt(normalizedHigh.s) <= (SECP256K1_N >> 1n));
assert.equal(getAddress(await recoverAddress({ hash: digest, signature: normalizedHigh })), getAddress(local.address));
await assert.rejects(() => recoverKmsDigestSignature(digest, highDer, "0x1111111111111111111111111111111111111111"), /recovery mismatch/);
assert.throws(() => parseKmsDerSignature(new Uint8Array([0x31, 0x00])), /SEQUENCE/);

const account = await kmsToAccount(mock);
assert.equal(getAddress(account.address), getAddress(local.address));
const typed = {
  domain: { name: "REACTOR.Test", version: "1", chainId: 1883, verifyingContract: "0x1111111111111111111111111111111111111111" as const },
  types: { Thing: [{ name: "value", type: "uint256" }] },
  primaryType: "Thing" as const,
  message: { value: 7n },
};
const typedSig = await account.signTypedData(typed);
assert.equal(getAddress(await recoverTypedDataAddress({ ...typed, signature: typedSig })), getAddress(local.address));

const tx = await account.signTransaction({
  type: "eip1559",
  chainId: 1883,
  nonce: 0,
  gas: 21_000n,
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n,
  to: "0x2222222222222222222222222222222222222222",
  value: 0n,
});
assert.equal(getAddress(await recoverTransactionAddress({ serializedTransaction: tx })), getAddress(local.address));

console.log("AWS KMS EVM signer tests: ok");
