const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const NAME = "REACTOR.AutomationGateway";
const VERSION = "1";
const TYPESTRING =
  "MaintenanceJob(address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash)";
const MAX_TTL_SEC = 30n * 60n;
const HOPS_SEED_TEXT = "REACTOR.MaintenanceHops.v1";

export const ACTION_SELF_BURN = 0;
export const ACTION_SETTLE_QUOTE = 1;
export const ACTION_SUBMIT_EPOCH = 2;
export const ACTION_TOP10_BUYBACK = 3;
export const ACTION_ROLL_EPOCH = 4;
export const ACTION_BUYBACK = 5;

const JOB_COMPONENTS = [
  { name: "gateway", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "action", type: "uint8" },
  { name: "payloadHash", type: "bytes32" },
  { name: "jobId", type: "bytes32" },
  { name: "validAfter", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "snapshotHash", type: "bytes32" },
];

const HOP_COMPONENTS = [
  { name: "adapter", type: "address" },
  { name: "tokenIn", type: "address" },
  { name: "tokenOut", type: "address" },
  { name: "minOut", type: "uint256" },
  { name: "data", type: "bytes" },
];

function normalizeHex(value, bytes) {
  if (typeof value !== "string" || !value.startsWith("0x")) throw new Error("hex value required");
  if (bytes !== undefined && value.length !== 2 + bytes * 2) throw new Error(`expected ${bytes}-byte hex`);
  return value.toLowerCase();
}

export function normalizeJob(raw) {
  if (!raw || typeof raw !== "object") throw new Error("job object required");
  return {
    gateway: String(raw.gateway),
    chainId: BigInt(raw.chainId),
    action: Number(raw.action),
    payloadHash: normalizeHex(String(raw.payloadHash), 32),
    jobId: normalizeHex(String(raw.jobId), 32),
    validAfter: BigInt(raw.validAfter),
    deadline: BigInt(raw.deadline),
    snapshotHash: normalizeHex(String(raw.snapshotHash), 32),
  };
}

export function serializeJob(job) {
  return {
    ...job,
    chainId: job.chainId.toString(),
    validAfter: job.validAfter.toString(),
    deadline: job.deadline.toString(),
  };
}

export async function maintenanceDomainSeparator(chainId, gateway) {
  const { encodeAbiParameters, keccak256, toBytes } = await import("viem");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(toBytes(NAME)),
        keccak256(toBytes(VERSION)),
        BigInt(chainId),
        gateway,
      ],
    ),
  );
}

export async function maintenanceJobDigest(job) {
  const { encodeAbiParameters, encodePacked, keccak256, toBytes } = await import("viem");
  const typeHash = keccak256(toBytes(TYPESTRING));
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        typeHash,
        job.gateway,
        job.chainId,
        job.action,
        job.payloadHash,
        job.jobId,
        job.validAfter,
        job.deadline,
        job.snapshotHash,
      ],
    ),
  );
  return keccak256(
    encodePacked(
      ["string", "bytes32", "bytes32"],
      ["\x19\x01", await maintenanceDomainSeparator(job.chainId, job.gateway), structHash],
    ),
  );
}

export function assertJobWindow(job, nowSec = BigInt(Math.floor(Date.now() / 1000)), skewSec = 0n) {
  if (job.deadline < job.validAfter) throw new Error("maintenance job window inverted");
  if (job.deadline - job.validAfter > MAX_TTL_SEC) throw new Error("maintenance job window exceeds 30m");
  if (nowSec + skewSec < job.validAfter) throw new Error("maintenance job not yet valid");
  if (nowSec - skewSec > job.deadline) throw new Error("maintenance job expired");
}

async function hashHops(hops) {
  const { encodeAbiParameters, keccak256, toBytes } = await import("viem");
  let acc = keccak256(toBytes(HOPS_SEED_TEXT));
  for (const h of hops) {
    acc = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
          { type: "bytes32" },
        ],
        [acc, h.adapter, h.tokenIn, h.tokenOut, BigInt(h.minOut), keccak256(h.data)],
      ),
    );
  }
  return acc;
}

async function epochSnapshotHash(epochId, targets, weights, valuationSnapshot, pricingHealthHash) {
  const { encodeAbiParameters, keccak256 } = await import("viem");
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [
        BigInt(epochId),
        keccak256(encodeAbiParameters([{ type: "address[]" }], [targets])),
        keccak256(encodeAbiParameters([{ type: "uint256[]" }], [weights.map(BigInt)])),
        valuationSnapshot,
        pricingHealthHash,
      ],
    ),
  );
}

export async function assertArgsMatchJob(job, args) {
  const { decodeAbiParameters, encodeAbiParameters, keccak256 } = await import("viem");
  let payload;
  let snapshot;
  if (job.action === ACTION_SELF_BURN) {
    const [token, amount, minTargetOut] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
      args,
    );
    payload = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
        [token, amount, minTargetOut],
      ),
    );
    snapshot = ZERO32;
  } else if (job.action === ACTION_SETTLE_QUOTE) {
    const [quote, amount, hops, minOut] = decodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "tuple[]", components: HOP_COMPONENTS },
        { type: "uint256" },
      ],
      args,
    );
    const hopsHash = await hashHops(hops);
    payload = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
        [quote, amount, minOut, hopsHash],
      ),
    );
    snapshot = hopsHash;
  } else if (job.action === ACTION_SUBMIT_EPOCH) {
    const [epochId, targets, weights, valuationSnapshot, pricingHealth] = decodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address[]" },
        { type: "uint256[]" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      args,
    );
    const snap = await epochSnapshotHash(epochId, targets, weights, valuationSnapshot, pricingHealth);
    payload = snap;
    snapshot = snap;
  } else if (job.action === ACTION_TOP10_BUYBACK) {
    const [token, amount, hops, minTargetOut] = decodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "tuple[]", components: HOP_COMPONENTS },
        { type: "uint256" },
      ],
      args,
    );
    const hopsHash = await hashHops(hops);
    payload = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
        [token, amount, minTargetOut, hopsHash],
      ),
    );
    snapshot = hopsHash;
  } else if (job.action === ACTION_ROLL_EPOCH) {
    const [epochId] = decodeAbiParameters([{ type: "uint256" }], args);
    payload = keccak256(encodeAbiParameters([{ type: "uint256" }], [epochId]));
    snapshot = payload;
  } else if (job.action === ACTION_BUYBACK) {
    const [quote, amount, hops, minOut] = decodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "tuple[]", components: HOP_COMPONENTS },
        { type: "uint256" },
      ],
      args,
    );
    const hopsHash = await hashHops(hops);
    payload = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
        [quote, amount, minOut, hopsHash],
      ),
    );
    snapshot = hopsHash;
  } else {
    throw new Error(`unknown maintenance action ${job.action}`);
  }
  if (payload.toLowerCase() !== job.payloadHash.toLowerCase()) throw new Error("maintenance payload hash mismatch");
  if (snapshot.toLowerCase() !== job.snapshotHash.toLowerCase()) throw new Error("maintenance snapshot hash mismatch");
  return { payload, snapshot };
}

const REPORT_PARAMS = [
  { type: "tuple", components: JOB_COMPONENTS },
  { type: "bytes" },
  { type: "bytes" },
];

const GATEWAY_ABI = [
  {
    type: "function",
    name: "onReport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadata", type: "bytes" },
      { name: "report", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "usedJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

export async function buildRelayCalldata(job, signature, args) {
  const { encodeAbiParameters, encodeFunctionData } = await import("viem");
  const report = encodeAbiParameters(REPORT_PARAMS, [job, signature, args]);
  return encodeFunctionData({ abi: GATEWAY_ABI, functionName: "onReport", args: ["0x", report] });
}

export async function makeSignedEnvelope({ job, signature, args }) {
  await assertArgsMatchJob(job, args);
  return {
    version: 1,
    job: serializeJob(job),
    signature,
    args,
    calldata: await buildRelayCalldata(job, signature, args),
  };
}

export async function verifySignedEnvelope(rawEnvelope, config) {
  const { getAddress, recoverAddress } = await import("viem");
  if (!rawEnvelope || rawEnvelope.version !== 1) throw new Error("unsupported managed relay envelope version");
  const job = normalizeJob(rawEnvelope.job);
  const expectedGateway = getAddress(config.gateway);
  if (getAddress(job.gateway) !== expectedGateway) throw new Error("wrong AutomationGateway");
  if (job.chainId !== BigInt(config.chainId)) throw new Error("wrong chain id");
  assertJobWindow(job, config.nowSec ?? BigInt(Math.floor(Date.now() / 1000)), BigInt(config.skewSec ?? 0));
  await assertArgsMatchJob(job, rawEnvelope.args);
  const expectedCalldata = await buildRelayCalldata(job, rawEnvelope.signature, rawEnvelope.args);
  if (expectedCalldata.toLowerCase() !== String(rawEnvelope.calldata).toLowerCase()) {
    throw new Error("relay calldata differs from signed envelope");
  }
  const digest = await maintenanceJobDigest(job);
  const signer = getAddress(await recoverAddress({ hash: digest, signature: rawEnvelope.signature }));
  if (signer !== getAddress(config.jobSigner)) throw new Error("maintenance signature signer mismatch");
  return { job, signature: rawEnvelope.signature, args: rawEnvelope.args, calldata: expectedCalldata, digest, signer };
}

export function relayDelayMs(role, configured) {
  if (configured !== undefined && configured !== null && configured !== "") {
    const n = Number(configured);
    if (!Number.isFinite(n) || n < 0 || n > 120_000) throw new Error("invalid relay delay");
    return Math.floor(n);
  }
  return String(role).toUpperCase() === "B" ? 15_000 : 0;
}

export { GATEWAY_ABI, JOB_COMPONENTS, HOP_COMPONENTS, MAX_TTL_SEC, ZERO32 };
