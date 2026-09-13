import type { Hex } from "viem";
import type { DigestSignerBackend } from "./kms-evm.ts";

export const KMS_KEY_SPEC = "ECC_SECG_P256K1";
export const KMS_SIGNING_ALGORITHM = "ECDSA_SHA_256";

export type AwsKmsPublicKeyResult = {
  PublicKey?: Uint8Array | ArrayBufferView;
  KeySpec?: string;
  KeyUsage?: string;
  SigningAlgorithms?: string[];
};

export type AwsKmsSignResult = {
  Signature?: Uint8Array | ArrayBufferView;
  SigningAlgorithm?: string;
};

function bytes(value: Uint8Array | ArrayBufferView | undefined, label: string): Uint8Array {
  if (!value) throw new Error(`AWS KMS ${label} missing`);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function validateAwsKmsPublicKey(result: AwsKmsPublicKeyResult): Uint8Array {
  if (result.KeySpec !== KMS_KEY_SPEC) throw new Error(`AWS KMS key spec must be ${KMS_KEY_SPEC}`);
  if (result.KeyUsage !== "SIGN_VERIFY") throw new Error("AWS KMS key usage must be SIGN_VERIFY");
  if (!result.SigningAlgorithms?.includes(KMS_SIGNING_ALGORITHM)) {
    throw new Error(`AWS KMS key must support ${KMS_SIGNING_ALGORITHM}`);
  }
  return bytes(result.PublicKey, "public key");
}

export function validateAwsKmsSignature(result: AwsKmsSignResult): Uint8Array {
  if (result.SigningAlgorithm !== KMS_SIGNING_ALGORITHM) {
    throw new Error(`AWS KMS returned unexpected signing algorithm ${String(result.SigningAlgorithm)}`);
  }
  return bytes(result.Signature, "signature");
}

/**
 * Load AWS SDK v3 at runtime. Lambda's managed Node runtime provides v3, while
 * tests/CI do not need AWS credentials or the SDK package installed locally.
 * Production deployment pins the Lambda runtime and smoke-checks this loader.
 */
export async function createAwsKmsDigestSigner(opts: {
  keyId: string;
  region?: string;
  endpoint?: string;
}): Promise<DigestSignerBackend> {
  if (!opts.keyId) throw new Error("AWS KMS key id required");
  const moduleName = "@aws-sdk/client-kms";
  const aws = (await import(moduleName)) as Record<string, new (...args: never[]) => unknown>;
  const KMSClient = aws.KMSClient as unknown as new (config: Record<string, unknown>) => { send(command: unknown): Promise<unknown> };
  const GetPublicKeyCommand = aws.GetPublicKeyCommand as unknown as new (input: Record<string, unknown>) => unknown;
  const SignCommand = aws.SignCommand as unknown as new (input: Record<string, unknown>) => unknown;
  if (!KMSClient || !GetPublicKeyCommand || !SignCommand) throw new Error("AWS KMS SDK v3 unavailable");
  const client = new KMSClient({ region: opts.region, endpoint: opts.endpoint });

  return {
    keyId: opts.keyId,
    async getPublicKey() {
      const out = (await client.send(new GetPublicKeyCommand({ KeyId: opts.keyId }))) as AwsKmsPublicKeyResult;
      return validateAwsKmsPublicKey(out);
    },
    async signDigest(digest: Hex) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) throw new Error("AWS KMS signing input must be 32-byte digest");
      const message = Buffer.from(digest.slice(2), "hex");
      const out = (await client.send(
        new SignCommand({
          KeyId: opts.keyId,
          Message: message,
          MessageType: "DIGEST",
          SigningAlgorithm: KMS_SIGNING_ALGORITHM,
        }),
      )) as AwsKmsSignResult;
      return validateAwsKmsSignature(out);
    },
  };
}
