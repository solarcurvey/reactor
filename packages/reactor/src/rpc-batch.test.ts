import {
  CANONICAL_MULTICALL3,
  chainKeyOf,
  indexCalls,
  multicallProbeState,
  probeMulticall3,
  readContractsBatched,
  resetMulticallProbeForTests,
  type BatchClient,
  type BatchContract,
} from "./rpc-batch.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

resetMulticallProbeForTests();

const abi = [{ name: "list", type: "function" }];

function contract(i: number): BatchContract {
  return { address: "0x0000000000000000000000000000000000000001", abi, functionName: "list", args: [BigInt(i)] };
}

{
  const indexed = indexCalls("0x0000000000000000000000000000000000000001", abi, "list", 3);
  assert(indexed.length === 3 && indexed[2]!.args?.[0] === 2n, "indexCalls");
}

{
  let reads = 0;
  const client: BatchClient = {
    chain: { id: 1 },
    getBytecode: async () => "0x",
    multicall: async () => {
      throw new Error("must not multicall without bytecode");
    },
    readContract: async (c) => {
      reads += 1;
      return Number(c.args?.[0] ?? 0);
    },
  };
  const out = await readContractsBatched<number>(client, [contract(4), contract(5)], { chainKey: "no-code" });
  assert(out.join() === "4,5", `parallel fallback ${out}`);
  assert(reads === 2, "two independent reads");
  assert(multicallProbeState("no-code") === "absent", "empty bytecode is absent");
  assert(!(await probeMulticall3(client, "no-code")), "cached absent");
}

{
  let multicalls = 0;
  let reads = 0;
  const client: BatchClient = {
    chain: { id: 5042002 },
    getBytecode: async () => "0x60806040",
    multicall: async ({ contracts, allowFailure }) => {
      multicalls += 1;
      if (allowFailure) {
        return contracts.map((c, i) =>
          i === 1
            ? { status: "failure", result: undefined }
            : { status: "success", result: Number(c.args?.[0] ?? 0) },
        );
      }
      return contracts.map((c) => Number(c.args?.[0] ?? 0));
    },
    readContract: async () => {
      reads += 1;
      return -1;
    },
  };
  const ok = await readContractsBatched<number>(client, [contract(1), contract(2)], { chainKey: "anvil" });
  assert(ok.join() === "1,2", `verified multicall ${ok}`);
  assert(multicalls === 1 && reads === 0, "used multicall");
  assert(multicallProbeState("anvil") === "verified", "success marks verified");

  const soft = await readContractsBatched<number | undefined>(client, [contract(8), contract(9)], {
    chainKey: "anvil",
    allowFailure: true,
  });
  assert(soft[0] === 8 && soft[1] === undefined, `allowFailure normalize ${soft}`);
  assert(multicalls === 2, "second call still multicall");
}

{
  let reads = 0;
  const client: BatchClient = {
    getBytecode: async () => "0x60806040",
    multicall: async () => {
      throw new Error("Arc multicall revert / missing selector");
    },
    readContract: async (c) => {
      reads += 1;
      return Number(c.args?.[0] ?? 0);
    },
  };
  const out = await readContractsBatched<number>(client, [contract(3)], { chainKey: "arc-fake" });
  assert(out[0] === 3 && reads === 1, "failed multicall falls back");
  assert(multicallProbeState("arc-fake") === "absent", "failed multicall is absent");
  const again = await readContractsBatched<number>(client, [contract(7), contract(8)], { chainKey: "arc-fake" });
  assert(again.join() === "7,8" && reads === 3, "cached absent skips multicall");
}

{
  const client: BatchClient = {
    readContract: async (c) => Number(c.args?.[0] ?? 0),
  };
  const out = await readContractsBatched<number>(client, [contract(1), contract(2)], { chainKey: "no-probe" });
  assert(out.join() === "1,2", "client without getBytecode still batches via Promise.all");
  assert(chainKeyOf({ chain: { id: 5042002 } }) === "5042002", "chain key");
}

{
  let failed = 0;
  const client: BatchClient = {
    readContract: async (c) => {
      if (Number(c.args?.[0]) === 1) {
        failed += 1;
        throw new Error("revert");
      }
      return 9;
    },
  };
  const out = await readContractsBatched<number | undefined>(client, [contract(0), contract(1)], {
    allowFailure: true,
    chainKey: "soft",
  });
  assert(out[0] === 9 && out[1] === undefined && failed === 1, "Promise.all allowFailure");
}

assert(CANONICAL_MULTICALL3 === "0xcA11bde05977b3631167028862bE2a173976CA11", "canonical multicall3");

const empty = await readContractsBatched({ readContract: async () => 1 }, []);
assert(empty.length === 0, "empty");

console.log("rpc-batch tests ok");
