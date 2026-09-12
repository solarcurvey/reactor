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
console.log("launch-auth tests ok");
