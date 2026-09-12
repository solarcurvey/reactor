/**
 * Arc Public Testnet (5042002) rehearsal helpers.
 * Never claim a deploy without an explorer hash. Mainnet 5042 is blocked.
 */
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_MAINNET_CHAIN_ID = 5042;
export const EIP170 = 24_576;
export const CANONICAL_USDC = "0x3600000000000000000000000000000000000000" as const;
export const EXPLORER = "https://testnet.arcscan.app";
export const CIRCLE_FAUCET = "https://faucet.circle.com";
export const FAUCET_GRAPHQL = "https://faucet.circle.com/api/graphql";
export const CIRCLE_DRIPS = "https://api.circle.com/v1/faucet/drips";
export const ANVIL0_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** Documented Arc Testnet RPCs. Primary Circle endpoints first. */
export const ARC_TESTNET_RPCS = [
  "https://rpc.testnet.arc.io",
  "https://rpc.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.quicknode.testnet.arc.io",
] as const;

export const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type RpcProbe = {
  url: string;
  ok: boolean;
  chainId?: number;
  chainHex?: string;
  blockNumber?: string;
  httpStatus?: number;
  elapsedMs: number;
  error?: string;
  bodySnippet?: string;
};

export type FaucetAttempt = {
  method: string;
  url: string;
  httpStatus?: number;
  ok: boolean;
  error?: string;
  bodySnippet?: string;
  note: string;
};

export type ClaimInput = {
  chainId: number;
  txHash?: string;
  explorerConfirmed?: boolean;
  runtimeOverEip170?: boolean;
};

export type ClaimDecision = {
  claimed: boolean;
  reason: string;
};

export function refuseMainnet(chainId: number): void {
  if (chainId === ARC_MAINNET_CHAIN_ID) {
    throw new Error("Arc Mainnet (5042) is hard-blocked. Do not deploy.");
  }
}

export function isAnvil0Key(pk: string | undefined): boolean {
  return Boolean(pk && pk.toLowerCase() === ANVIL0_PK);
}

export function claimDecision(input: ClaimInput): ClaimDecision {
  refuseMainnet(input.chainId);
  if (input.chainId !== ARC_TESTNET_CHAIN_ID) {
    return { claimed: false, reason: `unexpected chain ${input.chainId} — not Arc Public Testnet` };
  }
  if (input.runtimeOverEip170) {
    return { claimed: false, reason: "Factory runtime > EIP-170 — create would fail; not claimed" };
  }
  if (!input.txHash) {
    return { claimed: false, reason: "no broadcast hash — eth_sendRawTransaction not confirmed" };
  }
  if (!input.explorerConfirmed) {
    return {
      claimed: false,
      reason: `broadcast hash present but explorer receipt not confirmed on ${EXPLORER}`,
    };
  }
  return { claimed: true, reason: `explorer-confirmed on ${EXPLORER}` };
}

export function redactSecrets<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/pk|private|secret|key|mnemonic|authorization/i.test(k) && typeof v === "string") {
      out[k] = v.length > 0 ? `<redacted ${v.length} chars>` : "";
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out as T;
}

export async function rpcCall(
  url: string,
  method: string,
  params: unknown[] = [],
  timeoutMs = 15_000,
): Promise<{ ok: boolean; status?: number; elapsedMs: number; result?: unknown; error?: string; bodySnippet?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": BROWSER_UA },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const elapsedMs = Date.now() - t0;
    let parsed: { result?: unknown; error?: { message?: string } } = {};
    try {
      parsed = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
    } catch {
      return { ok: false, status: res.status, elapsedMs, error: `non-JSON (${res.status})`, bodySnippet: text.slice(0, 400) };
    }
    if (!res.ok || parsed.error) {
      return {
        ok: false,
        status: res.status,
        elapsedMs,
        error: parsed.error?.message ?? `HTTP ${res.status}`,
        bodySnippet: text.slice(0, 400),
      };
    }
    return { ok: true, status: res.status, elapsedMs, result: parsed.result };
  } catch (e) {
    return { ok: false, elapsedMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeRpc(url: string): Promise<RpcProbe> {
  const chain = await rpcCall(url, "eth_chainId");
  const probe: RpcProbe = { url, ok: false, elapsedMs: chain.elapsedMs, httpStatus: chain.status };
  if (!chain.ok) {
    probe.error = chain.error;
    probe.bodySnippet = chain.bodySnippet;
    return probe;
  }
  const hex = String(chain.result);
  const chainId = Number.parseInt(hex, 16);
  probe.chainHex = hex;
  probe.chainId = chainId;
  if (chainId === ARC_MAINNET_CHAIN_ID) {
    probe.error = "mainnet blocked";
    return probe;
  }
  const block = await rpcCall(url, "eth_blockNumber");
  probe.elapsedMs += block.elapsedMs;
  if (block.ok) probe.blockNumber = String(block.result);
  probe.ok = chainId === ARC_TESTNET_CHAIN_ID;
  if (!probe.ok) probe.error = `chain ${chainId} is not 5042002`;
  return probe;
}

export async function probeAllRpcs(urls: readonly string[] = ARC_TESTNET_RPCS): Promise<RpcProbe[]> {
  const out: RpcProbe[] = [];
  for (const url of urls) out.push(await probeRpc(url));
  return out;
}

export function verifiedChain(probes: RpcProbe[]): { ok: boolean; chainId?: number; rpc?: string; note: string } {
  const live = probes.find((p) => p.ok && p.chainId === ARC_TESTNET_CHAIN_ID);
  if (live) {
    return { ok: true, chainId: ARC_TESTNET_CHAIN_ID, rpc: live.url, note: `eth_chainId ${live.chainHex} = ${ARC_TESTNET_CHAIN_ID}` };
  }
  const blocked = probes.filter((p) => !p.ok);
  return {
    ok: false,
    note: blocked.length
      ? `no live 5042002 RPC. errors: ${blocked.map((p) => `${p.url}: ${p.error ?? p.httpStatus}`).join("; ")}`
      : "no RPC probed",
  };
}

async function httpJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
  return { status: res.status, body: await res.text() };
}

export async function attemptCircleFaucet(address: `0x${string}`): Promise<FaucetAttempt[]> {
  const attempts: FaucetAttempt[] = [];
  const headers = {
    "content-type": "application/json",
    "user-agent": BROWSER_UA,
    origin: CIRCLE_FAUCET,
    referer: `${CIRCLE_FAUCET}/`,
  };

  try {
    const page = await fetch(CIRCLE_FAUCET, { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(15_000) });
    const html = await page.text();
    attempts.push({
      method: "GET",
      url: CIRCLE_FAUCET,
      httpStatus: page.status,
      ok: page.status === 200,
      bodySnippet: html.slice(0, 180),
      note: "Public faucet HTML (Next.js). Token drip is a GraphQL mutation gated by Google reCAPTCHA.",
    });
  } catch (e) {
    attempts.push({
      method: "GET",
      url: CIRCLE_FAUCET,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      note: "faucet.circle.com GET failed",
    });
  }

  try {
    const gql = await httpJson(FAUCET_GRAPHQL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query:
          "mutation RequestToken($input: RequestTokenInput!) { requestToken(input: $input) { amount blockchain currency destinationAddress explorerLink hash status } }",
        variables: { input: { destinationAddress: address, token: "USDC", blockchain: "ARC" } },
      }),
    });
    const recaptcha = /RECAPTCHA_ERROR|ReCAPTCHA verification failed/i.test(gql.body);
    attempts.push({
      method: "POST GraphQL RequestToken",
      url: FAUCET_GRAPHQL,
      httpStatus: gql.status,
      ok: false,
      error: recaptcha ? "RECAPTCHA_ERROR — ReCAPTCHA verification failed" : gql.body.slice(0, 400),
      bodySnippet: gql.body.slice(0, 500),
      note: recaptcha
        ? "Exact blocker: Circle public faucet requires a human Google reCAPTCHA (v3 + v2 fallback). Headless VMs cannot complete the widget."
        : "GraphQL RequestToken did not drip USDC.",
    });
  } catch (e) {
    attempts.push({
      method: "POST GraphQL RequestToken",
      url: FAUCET_GRAPHQL,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      note: "faucet GraphQL unreachable",
    });
  }

  try {
    const drips = await httpJson(CIRCLE_DRIPS, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": BROWSER_UA },
      body: JSON.stringify({ address, blockchain: "ARC-TESTNET", usdc: true, native: true }),
    });
    attempts.push({
      method: "POST /v1/faucet/drips (no API key)",
      url: CIRCLE_DRIPS,
      httpStatus: drips.status,
      ok: false,
      error: drips.body.slice(0, 400),
      bodySnippet: drips.body.slice(0, 400),
      note: "Circle Developer faucet API. Docs require a mainnet-upgraded Circle account + Bearer API key. Not a permissionless drip.",
    });
  } catch (e) {
    attempts.push({
      method: "POST /v1/faucet/drips (no API key)",
      url: CIRCLE_DRIPS,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      note: "Circle drips API unreachable",
    });
  }

  return attempts;
}

export function faucetBlockerSummary(attempts: FaucetAttempt[]): string {
  const recaptcha = attempts.find((a) => /RECAPTCHA_ERROR/i.test(a.error ?? ""));
  if (recaptcha) {
    return `${recaptcha.url} → HTTP ${recaptcha.httpStatus ?? "?"} ${recaptcha.error}. Human reCAPTCHA required. Address is waiting for funds.`;
  }
  const first = attempts.find((a) => !a.ok);
  return first ? `${first.url}: ${first.error ?? first.note}` : "faucet attempts recorded; no drip";
}

export async function nativeBalance(rpc: string, address: `0x${string}`): Promise<bigint> {
  const r = await rpcCall(rpc, "eth_getBalance", [address, "latest"]);
  if (!r.ok) throw new Error(r.error ?? "eth_getBalance failed");
  return BigInt(String(r.result));
}

export async function codeSize(rpc: string, address: `0x${string}`): Promise<number> {
  const r = await rpcCall(rpc, "eth_getCode", [address, "latest"]);
  if (!r.ok) throw new Error(r.error ?? "eth_getCode failed");
  const hex = String(r.result ?? "0x");
  return hex === "0x" ? 0 : (hex.length - 2) / 2;
}

export function waitingAddressFromEnv(env: NodeJS.ProcessEnv = process.env): `0x${string}` | undefined {
  const a = env.ARC_TESTNET_ADDRESS ?? env.ARC_TESTNET_DEPLOYER;
  if (a && /^0x[a-fA-F0-9]{40}$/.test(a)) return a as `0x${string}`;
  return undefined;
}
