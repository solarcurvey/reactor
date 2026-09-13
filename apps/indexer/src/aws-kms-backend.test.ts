import assert from "node:assert/strict";
import {
  KMS_KEY_SPEC,
  KMS_SIGNING_ALGORITHM,
  validateAwsKmsPublicKey,
  validateAwsKmsSignature,
} from "./aws-kms-backend.ts";

const pub = new Uint8Array([1, 2, 3]);
assert.deepEqual(
  validateAwsKmsPublicKey({
    PublicKey: pub,
    KeySpec: KMS_KEY_SPEC,
    KeyUsage: "SIGN_VERIFY",
    SigningAlgorithms: [KMS_SIGNING_ALGORITHM],
  }),
  pub,
);
assert.throws(() => validateAwsKmsPublicKey({ PublicKey: pub, KeySpec: "ECC_NIST_P256", KeyUsage: "SIGN_VERIFY", SigningAlgorithms: [KMS_SIGNING_ALGORITHM] }), /key spec/);
assert.throws(() => validateAwsKmsPublicKey({ PublicKey: pub, KeySpec: KMS_KEY_SPEC, KeyUsage: "ENCRYPT_DECRYPT", SigningAlgorithms: [KMS_SIGNING_ALGORITHM] }), /SIGN_VERIFY/);
assert.throws(() => validateAwsKmsPublicKey({ PublicKey: pub, KeySpec: KMS_KEY_SPEC, KeyUsage: "SIGN_VERIFY", SigningAlgorithms: [] }), /support/);

const sig = new Uint8Array([0x30, 0]);
assert.deepEqual(validateAwsKmsSignature({ Signature: sig, SigningAlgorithm: KMS_SIGNING_ALGORITHM }), sig);
assert.throws(() => validateAwsKmsSignature({ Signature: sig, SigningAlgorithm: "RSASSA_PSS_SHA_256" }), /unexpected/);

console.log("AWS KMS backend validation tests: ok");
