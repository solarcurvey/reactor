#!/usr/bin/env npx tsx
/**
 * Attempt a real Arc Public Testnet create of exact Factory bytecode.
 * Records tx or error. Never claims success without an explorer hash.
 * Mainnet 5042 is blocked.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const RPC = process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.io";
const artifact = join(root, "contracts/out/ReactorFactory.sol/ReactorFactory.json");

const out: Record<string, unknown> = {
  at: new Date().toISOString(),
  rpc: RPC,
  chainWanted: 5042002,
  eip170: 24576,
  claimed: false,
};

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result;
}

/** ABI-encode 7 constructor addresses (hook, router, vault, registry, core, auth, tickers). */
function dummyCtor() {
  const one = "0000000000000000000000000000000000000000000000000000000000000001";
  return "0x" + one.repeat(7);
}

async function main() {
  try {
    const chainHex = (await rpc("eth_chainId")) as string;
    const chainId = Number.parseInt(chainHex, 16);
    out.chainId = chainId;
    out.chainHex = chainHex;
    if (chainId === 5042) throw new Error("mainnet blocked");
    if (!existsSync(artifact)) {
      out.error = "Factory artifact missing — run forge build --sizes";
    } else {
      const j = JSON.parse(readFileSync(artifact, "utf8")) as {
        bytecode?: { object?: string };
        deployedBytecode?: { object?: string };
      };
      const creation = j.bytecode?.object ?? "0x";
      const runtime = j.deployedBytecode?.object ?? "0x";
      out.creationBytes = (creation.length - 2) / 2;
      out.runtimeBytes = (runtime.length - 2) / 2;
      out.runtimeOverEip170 = Number(out.runtimeBytes) > 24576;
      const data = creation + dummyCtor().slice(2);
      try {
        const latest = (await rpc("eth_blockNumber")) as string;
        out.head = latest;
        const gas = await rpc("eth_estimateGas", [{ from: "0x0000000000000000000000000000000000000001", data }]);
        out.estimateGas = gas;
        out.estimateNote = "estimate succeeded with dummy ctor args — still not a broadcast create";
      } catch (e) {
        out.estimateError = e instanceof Error ? e.message : String(e);
      }
      const pk = process.env.ARC_TESTNET_PK ?? process.env.DEPLOYER_PK ?? "";
      if (!pk || pk.length < 10) {
        out.error =
          "no ARC_TESTNET_PK — eth_sendRawTransaction not attempted. RPC live + estimate recorded. Not claimed.";
      } else if (Number(out.runtimeBytes) > 24576) {
        out.error = `runtime ${out.runtimeBytes} > EIP-170 24576 — create would fail on Arc. Not sent.`;
      } else {
        out.error =
          "funded-key path reserved: this environment does not assemble a signed legacy create without a dedicated deployer. Record sizes + RPC liveness only.";
      }
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }

  writeFileSync(join(root, "deployments/arc-factory-attempt.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

void main();
