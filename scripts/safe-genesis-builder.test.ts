import { buildBatches, loadArtifactAddresses, packMultiSend, resolveRoles } from "./safe-genesis-builder.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const addrs = loadArtifactAddresses();
assert(addrs.Guardian && addrs.ReactorFactory && addrs.USDC && addrs.CoreVesting, "local.json genesis addresses");
assert(addrs.TestCORE || addrs.CoreToken, "CORE address present");

const roles = resolveRoles(addrs);
assert(roles.safe !== roles.deployer, "Safe ≠ deployer");
assert(roles.safe === "0x0000000000000000000000000000000000000001", "default rehearsal Safe");

const built = buildBatches(addrs);
assert(built.batchA.length >= 5, `Batch A has real txs (${built.batchA.length})`);
assert(built.batchB.length === 2, "Batch B is activateLaunch + unpause");
assert(built.batchA.every((t) => t.data.startsWith("0x") && t.data.length >= 10), "Batch A calldata filled");
assert(built.batchB[1]!.meta.name.includes("pauseLaunches(false)"), "unpause is last");
assert(built.batchA.every((t) => t.to && t.to !== "0x0000000000000000000000000000000000000000"), "no zero to");

const packed = packMultiSend(built.batchA);
assert(packed.startsWith("0x") && packed.length > 20, "MultiSend packed");

let threw = false;
try {
  process.env.EXPECTED_SAFE = roles.deployer;
  resolveRoles(addrs);
} catch (e) {
  threw = e instanceof Error && e.message.includes("must not be the local deployer");
} finally {
  delete process.env.EXPECTED_SAFE;
}
assert(threw, "Safe === deployer rejected");

console.log("safe-genesis-builder tests ok", { batchA: built.batchA.length, omitted: built.omitted });
