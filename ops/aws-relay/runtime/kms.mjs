import { createPublicKey } from "node:crypto";

const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = CURVE_N >> 1n;

function readDerLength(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined) throw new Error("DER length missing");
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const octets = first & 0x7f;
  if (octets === 0 || octets > 4) throw new Error("DER length unsupported");
  let length = 0;
  for (let i = 0; i < octets; i++) {
    const b = bytes[offset + 1 + i];
    if (b === undefined) throw new Error("DER length truncated");
    length = (length << 8) | b;
  }
  return { length, next: offset + 1 + octets };
}

function readDerInteger(bytes, offset) {
  if (bytes[offset] !== 0x02) throw new Error("DER integer expected");
  const { length, next } = readDerLength(bytes, offset + 1);
  const end = next + length;
  if (length === 0 || end > bytes.length) throw new Error("DER integer truncated");
  let body = bytes.slice(next, end);
  if ((body[0] & 0x80) !== 0) throw new Error("DER negative integer rejected");
  while (body.length > 1 && body[0] === 0) body = body.slice(1);
  if (body.length > 32) throw new Error("DER integer exceeds secp256k1 width");
  const hex = Buffer.from(body).toString("hex") || "00";
  return { value: BigInt(`0x${hex}`), next: end };
}

export function parseDerEcdsaSignature(signature) {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  if (bytes[0] !== 0x30) throw new Error("DER sequence expected");
  const seq = readDerLength(bytes, 1);
  const seqEnd = seq.next + seq.length;
  if (seqEnd !== bytes.length) throw new Error("DER sequence length mismatch");
  const r = readDerInteger(bytes, seq.next);
  const s = readDerInteger(bytes, r.next);
  if (s.next !== seqEnd) throw new Error("DER trailing bytes rejected");
  if (r.value <= 0n || r.value >= CURVE_N || s.value <= 0n || s.value >= CURVE_N) {
    throw new Error("DER signature scalar out of range");
  }
  return { r: r.value, s: s.value };
}

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return new Uint8Array(Buffer.from(normalized + pad, "base64"));
}

export async function publicKeyDerToAddress(publicKeyDer) {
  const { getAddress, keccak256 } = await import("viem");
  const key = createPublicKey({ key: Buffer.from(publicKeyDer), format: "der", type: "spki" });
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "secp256k1" || !jwk.x || !jwk.y) {
    throw new Error("KMS public key is not secp256k1");
  }
  const x = base64UrlBytes(jwk.x);
  const y = base64UrlBytes(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new Error("secp256k1 public key coordinate width mismatch");
  const hash = keccak256(new Uint8Array(Buffer.concat([Buffer.from(x), Buffer.from(y)])));
  return getAddress(`0x${hash.slice(-40)}`);
}

function scalarHex(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function signatureHex(r, s, yParity) {
  const v = (27 + yParity).toString(16).padStart(2, "0");
  return `0x${r.toString(16).padStart(64, "0")}${s.toString(16).padStart(64, "0")}${v}`;
}

export async function awsKmsBackend(region = process.env.AWS_REGION) {
  const { KMSClient, GetPublicKeyCommand, SignCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({ region });
  return {
    async getPublicKey(keyId) {
      const out = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
      if (!out.PublicKey) throw new Error("KMS GetPublicKey returned no key");
      return new Uint8Array(out.PublicKey);
    },
    async signDigest(keyId, digest) {
      const out = await client.send(
        new SignCommand({
          KeyId: keyId,
          Message: Buffer.from(digest.slice(2), "hex"),
          MessageType: "DIGEST",
          SigningAlgorithm: "ECDSA_SHA_256",
        }),
      );
      if (!out.Signature) throw new Error("KMS Sign returned no signature");
      return new Uint8Array(out.Signature);
    },
  };
}

export async function resolveKmsAddress(backend, keyId, expectedAddress) {
  const { getAddress } = await import("viem");
  if (expectedAddress) return getAddress(expectedAddress);
  return publicKeyDerToAddress(await backend.getPublicKey(keyId));
}

export async function signDigestWithKms({ backend, keyId, digest, expectedAddress }) {
  const { getAddress, recoverAddress } = await import("viem");
  const signer = await resolveKmsAddress(backend, keyId, expectedAddress);
  const parsed = parseDerEcdsaSignature(await backend.signDigest(keyId, digest));
  const r = parsed.r;
  const s = parsed.s > HALF_N ? CURVE_N - parsed.s : parsed.s;
  for (const yParity of [0, 1]) {
    const serialized = signatureHex(r, s, yParity);
    const recovered = await recoverAddress({ hash: digest, signature: serialized });
    if (getAddress(recovered) === signer) {
      return {
        signer,
        r: scalarHex(r),
        s: scalarHex(s),
        yParity,
        serialized,
      };
    }
  }
  throw new Error("KMS signature does not recover to expected signer");
}

export async function signTransactionWithKms({ backend, keyId, expectedAddress, transaction }) {
  const { keccak256, serializeTransaction } = await import("viem");
  const unsigned = serializeTransaction(transaction);
  const digest = keccak256(unsigned);
  const sig = await signDigestWithKms({ backend, keyId, digest, expectedAddress });
  const serializedTransaction = serializeTransaction(transaction, {
    r: sig.r,
    s: sig.s,
    yParity: sig.yParity,
  });
  return { ...sig, digest, serializedTransaction };
}

export const __kmsTest = { CURVE_N, HALF_N, signatureHex };
