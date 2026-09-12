import { hashMetadata, LAUNCH_AUTH_TYPESTRING, LAUNCH_AUTH_TYPEHASH, MODE_FAIR, MODE_REWARDS, MODE_STANDARD } from "../../../packages/reactor/src/launch-auth.ts";
import { keccak256, toBytes } from "viem";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(MODE_STANDARD === 0 && MODE_REWARDS === 1 && MODE_FAIR === 2, "modes");
assert(
  LAUNCH_AUTH_TYPESTRING.includes("string ticker") && LAUNCH_AUTH_TYPESTRING.includes("string name") && LAUNCH_AUTH_TYPESTRING.includes("bytes32 metadataHash"),
  "full identity in typehash",
);
assert(LAUNCH_AUTH_TYPEHASH === keccak256(toBytes(LAUNCH_AUTH_TYPESTRING)), "typehash");
const a = hashMetadata("", "", "", "", "");
const b = hashMetadata("ipfs://x", "", "", "", "");
assert(a !== b, "metadata hash binds image");
{
  const { fairCurveConfig, FAIR_V1, INSTANT_CURVE_V1, launchConfigHash, resolveFairParams } = await import(
    "../../../packages/reactor/src/launch-auth.ts"
  );
  const p = resolveFairParams({ supply: 0, decimals: 0, duration: 0, auctionBps: 0, minRaise: 0 });
  const h = fairCurveConfig(p.supply, p.decimals, p.duration, p.auctionBps, p.minRaise);
  assert(h !== FAIR_V1 && h !== INSTANT_CURVE_V1, "fair binds params not FAIR_V1");
  const cfg = launchConfigHash({
    creator: "0x0000000000000000000000000000000000000001",
    ticker: "CAT",
    name: "Cat",
    metadataHash: a,
    quote: "0x0000000000000000000000000000000000000002",
    mode: MODE_REWARDS,
    factory: "0x0000000000000000000000000000000000000003",
    factoryVersion: 1,
    curveConfig: INSTANT_CURVE_V1,
  });
  assert(cfg.startsWith("0x") && cfg.length === 66, "launchConfigHash");
}
console.log("launch-auth tests ok");
