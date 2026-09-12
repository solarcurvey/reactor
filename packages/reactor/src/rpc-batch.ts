/**
 * Batched contract reads. Do not assume Arc ships Multicall3.
 *
 * Canonical Multicall3 (`0xca11…`) is present on many EVM stacks (including
 * recent Anvil). Arc Public Testnet is **not** guaranteed to have it. Probe
 * bytecode, then require one successful `multicall` before treating the chain
 * as verified. Any failure falls back to `Promise.all` of independent
 * `readContract` calls (parallel JSON-RPC, not a sequential waterfall).
 *
 * Live `POST /quote` tickets are not batched through this helper.
 */

export const CANONICAL_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export type BatchContract = {
  address: `0x${string}`;
  abi: readonly unknown[] | unknown[];
  functionName: string;
  args?: readonly unknown[];
};

export type BatchClient = {
  getBytecode?: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined | null>;
  multicall?: (args: { contracts: readonly BatchContract[]; allowFailure?: boolean }) => Promise<unknown>;
  readContract: (args: BatchContract) => Promise<unknown>;
  chain?: { id?: number };
};

export type MulticallProbe = "unknown" | "verified" | "absent";

const probe = new Map<string, MulticallProbe>();

export function resetMulticallProbeForTests(): void {
  probe.clear();
}

export function multicallProbeState(chainKey: string): MulticallProbe {
  return probe.get(chainKey) ?? "unknown";
}

export function chainKeyOf(client: BatchClient, explicit?: string): string {
  return explicit ?? String(client.chain?.id ?? "default");
}

async function bytecodePresent(client: BatchClient): Promise<boolean> {
  if (!client.getBytecode) return false;
  try {
    const code = await client.getBytecode({ address: CANONICAL_MULTICALL3 });
    return typeof code === "string" && code !== "0x" && code.length > 4;
  } catch {
    return false;
  }
}

/** Bytecode probe only — does not mark the chain verified. */
export async function probeMulticall3(client: BatchClient, chainKey?: string): Promise<boolean> {
  const key = chainKeyOf(client, chainKey);
  const cached = probe.get(key);
  if (cached === "verified") return true;
  if (cached === "absent") return false;
  return bytecodePresent(client);
}

function normalizeMulticall(rows: unknown, allowFailure: boolean): unknown[] {
  if (!Array.isArray(rows)) return [];
  if (!allowFailure) return rows;
  return rows.map((row) => {
    if (row && typeof row === "object" && "status" in row) {
      const rec = row as { status?: string; result?: unknown };
      return rec.status === "success" ? rec.result : undefined;
    }
    return row;
  });
}

export async function readContractsBatched<T = unknown>(
  client: BatchClient,
  contracts: BatchContract[],
  opts?: { allowFailure?: boolean; chainKey?: string },
): Promise<T[]> {
  if (contracts.length === 0) return [];
  const key = chainKeyOf(client, opts?.chainKey);
  const allowFailure = opts?.allowFailure ?? false;
  const state = probe.get(key) ?? "unknown";

  if (state !== "absent" && client.multicall) {
    const hasCode = state === "verified" || (await bytecodePresent(client));
    if (hasCode) {
      try {
        const rows = await client.multicall({ contracts, allowFailure });
        probe.set(key, "verified");
        return normalizeMulticall(rows, allowFailure) as T[];
      } catch {
        probe.set(key, "absent");
      }
    } else {
      probe.set(key, "absent");
    }
  }

  if (allowFailure) {
    return Promise.all(contracts.map((c) => client.readContract(c).catch(() => undefined))) as Promise<T[]>;
  }
  return Promise.all(contracts.map((c) => client.readContract(c))) as Promise<T[]>;
}

export function indexCalls(
  address: `0x${string}`,
  abi: BatchContract["abi"],
  functionName: string,
  n: number,
): BatchContract[] {
  const out: BatchContract[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ address, abi, functionName, args: [BigInt(i)] });
  }
  return out;
}
