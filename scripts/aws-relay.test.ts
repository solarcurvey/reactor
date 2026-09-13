import { createECDH, createPublicKey } from "node:crypto";
import { encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  jobIdFromOp,
  makeJob,
  maintenanceDomain,
  maintenanceDomainSeparator as canonicalDomainSeparator,
  maintenanceJobDigest as canonicalJobDigest,
  selfBurnPayload,
  ACTION_SELF_BURN,
  MAINTENANCE_JOB_TYPES,
} from "../packages/reactor/src/maintenance-job.ts";
import {
  __kmsTest,
  parseDerEcdsaSignature,
  publicKeyDerToAddress,
  signDigestWithKms,
} from "../apps/indexer/src/aws-relay/kms.mjs";
import {
  makeSignedEnvelope,
  maintenanceDomainSeparator,
  maintenanceJobDigest,
  relayDelayMs,
  verifySignedEnvelope,
} from "../apps/indexer/src/aws-relay/job.mjs";
import { __handlerTest } from "../apps/indexer/src/aws-relay/handler.mjs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(PK);

function b64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function spkiForPrivateKey(pk: `0x${string}`) {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(pk.slice(2), "hex"));
  const pub = ecdh.getPublicKey(undefined, "uncompressed");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "secp256k1",
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  return new Uint8Array(key.export({ format: "der", type: "spki" }));
}

function derInt(value: bigint) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
}

function derSig(r: bigint, s: bigint) {
  const body = Buffer.concat([derInt(r), derInt(s)]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}

async function main() {
  const gateway = "0x0000000000000000000000000000000000000011" as const;
  const token = "0x00000000000000000000000000000000000000aa" as const;
  const job = makeJob({
    gateway,
    chainId: 5042002n,
    action: ACTION_SELF_BURN,
    payloadHash: selfBurnPayload(token, 100n, 95n),
    jobId: jobIdFromOp("aws-kms-test:selfburn"),
    nowSec: 1_700_000_000n,
    snapshotHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  });
  const canonicalDigest = canonicalJobDigest(canonicalDomainSeparator(job.chainId, job.gateway), job);
  const runtimeDigest = await maintenanceJobDigest(job);
  assert(runtimeDigest === canonicalDigest, "runtime EIP-712 digest must equal canonical MaintenanceJob digest");
  assert(
    (await maintenanceDomainSeparator(job.chainId, job.gateway)) === canonicalDomainSeparator(job.chainId, job.gateway),
    "runtime domain separator must equal canonical separator",
  );

  const signed65 = await account.signTypedData({
    domain: maintenanceDomain(job.chainId, job.gateway),
    types: MAINTENANCE_JOB_TYPES,
    primaryType: "MaintenanceJob",
    message: job,
  });
  const r = BigInt(`0x${signed65.slice(2, 66)}`);
  const sLow = BigInt(`0x${signed65.slice(66, 130)}`);
  const sHigh = __kmsTest.CURVE_N - sLow;
  const publicKey = spkiForPrivateKey(PK);
  assert((await publicKeyDerToAddress(publicKey)) === account.address, "SPKI secp256k1 -> EVM address");
  const parsed = parseDerEcdsaSignature(derSig(r, sLow));
  assert(parsed.r === r && parsed.s === sLow, "DER r/s parser");

  const backend = {
    async getPublicKey() {
      return publicKey;
    },
    async signDigest(_keyId: string, digest: `0x${string}`) {
      assert(digest === canonicalDigest, "KMS must receive exact EIP-712 digest");
      return derSig(r, sHigh);
    },
  };
  const kmsSig = await signDigestWithKms({ backend, keyId: "alias/reactor-test", digest: canonicalDigest });
  assert(kmsSig.signer === account.address, "KMS signature recovers expected signer");
  assert(BigInt(kmsSig.s) <= __kmsTest.HALF_N, "KMS signature is low-s normalized");

  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
    [token, 100n, 95n],
  );
  const envelope = await makeSignedEnvelope({ job, signature: kmsSig.serialized, args });
  const verified = await verifySignedEnvelope(envelope, {
    chainId: job.chainId,
    gateway,
    jobSigner: account.address,
    nowSec: job.validAfter + 1n,
  });
  assert(verified.job.jobId === job.jobId, "signed envelope verifies");

  const tamperedArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
    [token, 101n, 95n],
  );
  try {
    await verifySignedEnvelope({ ...envelope, args: tamperedArgs }, {
      chainId: job.chainId,
      gateway,
      jobSigner: account.address,
      nowSec: job.validAfter + 1n,
    });
    throw new Error("tampered args must fail");
  } catch (e) {
    assert(e instanceof Error && /payload hash mismatch/.test(e.message), "tampered payload rejected before broadcast");
  }

  assert(relayDelayMs("A") === 0, "relay A immediate");
  assert(relayDelayMs("B") === 15_000, "relay B delayed failover");

  const prevEnv = { ...process.env };
  try {
    process.env.REACTOR_ENV = "PROD";
    process.env.JOB_SIGNER_PRIVATE_KEY = PK;
    try {
      __handlerTest.assertNoRawProductionKeys();
      throw new Error("raw production key must fail");
    } catch (e) {
      assert(e instanceof Error && /forbidden/.test(e.message), "raw production key is refused");
    }
  } finally {
    delete process.env.JOB_SIGNER_PRIVATE_KEY;
    if (prevEnv.REACTOR_ENV === undefined) delete process.env.REACTOR_ENV;
    else process.env.REACTOR_ENV = prevEnv.REACTOR_ENV;
  }

  console.log("aws managed relay unit tests ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
