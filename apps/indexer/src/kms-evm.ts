import { createPublicKey } from "node:crypto";
import {
  bytesToHex,
  getAddress,
  hashMessage,
  hashTypedData,
  keccak256,
  recoverAddress,
  serializeSignature,
  serializeTransaction,
  type Address,
  type Hex,
  type Signature,
} from "viem";
import { publicKeyToAddress, toAccount } from "viem/accounts";

export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const SECP256K1_HALF_N = SECP256K1_N >> 1n;

export interface DigestSignerBackend {
  readonly keyId?: string;
  getPublicKey(): Promise<Uint8Array>;
  signDigest(digest: Hex): Promise<Uint8Array>;
}

export type EvmKmsSignature = Signature & { yParity: 0 | 1 };

function readDerLength(bytes: Uint8Array, offset: number): { length: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) throw new Error("KMS DER truncated length");
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 2) throw new Error("KMS DER unsupported length");
  let length = 0;
  for (let i = 0; i < count; i++) {
    const b = bytes[offset + 1 + i];
    if (b === undefined) throw new Error("KMS DER truncated length bytes");
    length = (length << 8) | b;
  }
  return { length, next: offset + 1 + count };
}

function readDerInteger(bytes: Uint8Array, offset: number): { value: bigint; next: number } {
  if (bytes[offset] !== 0x02) throw new Error("KMS DER expected INTEGER");
  const { length, next } = readDerLength(bytes, offset + 1);
  if (length <= 0 || next + length > bytes.length) throw new Error("KMS DER invalid INTEGER length");
  let start = next;
  const end = next + length;
  const first = bytes[start]!;
  if ((first & 0x80) !== 0) throw new Error("KMS DER negative INTEGER");
  if (first === 0x00 && end - start > 1) {
    const second = bytes[start + 1]!;
    if ((second & 0x80) === 0) throw new Error("KMS DER non-canonical INTEGER padding");
    start++;
  }
  let value = 0n;
  for (let i = start; i < end; i++) value = (value << 8n) | BigInt(bytes[i]!);
  return { value, next: end };
}

function uint256Hex(value: bigint): Hex {
  if (value <= 0n || value >= SECP256K1_N) throw new Error("KMS ECDSA scalar out of range");
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

export function parseKmsDerSignature(der: Uint8Array): { r: bigint; s: bigint; sWasHigh: boolean } {
  if (der[0] !== 0x30) throw new Error("KMS DER expected SEQUENCE");
  const seq = readDerLength(der, 1);
  if (seq.next + seq.length !== der.length) throw new Error("KMS DER sequence length mismatch");
  const r = readDerInteger(der, seq.next);
  const s = readDerInteger(der, r.next);
  if (s.next !== der.length) throw new Error("KMS DER trailing bytes");
  if (r.value <= 0n || r.value >= SECP256K1_N || s.value <= 0n || s.value >= SECP256K1_N) {
    throw new Error("KMS ECDSA scalar out of range");
  }
  return { r: r.value, s: s.value, sWasHigh: s.value > SECP256K1_HALF_N };
}

export function kmsPublicKeyToAddress(spkiDer: Uint8Array): Address {
  const key = createPublicKey({ key: Buffer.from(spkiDer), format: "der", type: "spki" });
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "secp256k1" || !jwk.x || !jwk.y) {
    throw new Error("KMS public key is not secp256k1");
  }
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) throw new Error("KMS public key coordinate length invalid");
  const uncompressed = bytesToHex(Buffer.concat([Buffer.from([0x04]), x, y]));
  return getAddress(publicKeyToAddress(uncompressed));
}

export async function recoverKmsDigestSignature(
  digest: Hex,
  der: Uint8Array,
  expectedAddress: Address,
): Promise<EvmKmsSignature> {
  const parsed = parseKmsDerSignature(der);
  const normalizedS = parsed.sWasHigh ? SECP256K1_N - parsed.s : parsed.s;
  const r = uint256Hex(parsed.r);
  const s = uint256Hex(normalizedS);
  const expected = getAddress(expectedAddress);
  for (const yParity of [0, 1] as const) {
    const candidate: EvmKmsSignature = { r, s, yParity };
    const recovered = await recoverAddress({ hash: digest, signature: candidate });
    if (getAddress(recovered) === expected) return candidate;
  }
  throw new Error("KMS signature recovery mismatch");
}

export class KmsDigestSigner {
  private cachedAddress?: Address;

  constructor(readonly backend: DigestSignerBackend) {}

  async address(): Promise<Address> {
    if (!this.cachedAddress) this.cachedAddress = kmsPublicKeyToAddress(await this.backend.getPublicKey());
    return this.cachedAddress;
  }

  async signDigestParts(digest: Hex): Promise<EvmKmsSignature> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) throw new Error("KMS requires a 32-byte digest");
    const expected = await this.address();
    return recoverKmsDigestSignature(digest, await this.backend.signDigest(digest), expected);
  }

  async signDigest(digest: Hex): Promise<Hex> {
    return serializeSignature(await this.signDigestParts(digest));
  }
}

export async function kmsToAccount(backend: DigestSignerBackend) {
  const signer = new KmsDigestSigner(backend);
  const address = await signer.address();
  return toAccount({
    address,
    async sign({ hash }) {
      return signer.signDigest(hash);
    },
    async signMessage({ message }) {
      return signer.signDigest(hashMessage(message));
    },
    async signTypedData(typedData) {
      return signer.signDigest(hashTypedData(typedData));
    },
    async signTransaction(transaction, { serializer } = {}) {
      const serialize = serializer ?? serializeTransaction;
      const unsigned = serialize(transaction);
      const signature = await signer.signDigestParts(keccak256(unsigned));
      return serialize(transaction, signature);
    },
  });
}
