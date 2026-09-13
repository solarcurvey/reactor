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

/** Same POST /quote body as `apps/web/src/components/trade-panel.tsx`. */
export function productionQuoteBody(input: {
  side: "BUY" | "SELL";
  token: string;
  usdc: string;
  amountIn: string;
  slippageBps: number;
  recipient: string;
}): {
  kind: "BUY" | "SELL";
  token: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
  recipient: string;
} {
  const buy = input.side === "BUY";
  return {
    kind: input.side,
    token: input.token,
    tokenIn: buy ? input.usdc : input.token,
    tokenOut: buy ? input.token : input.usdc,
    amountIn: input.amountIn,
    slippageBps: Math.max(1, input.slippageBps),
    recipient: input.recipient,
  };
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

/**
 * Standing LOCAL/non-PROD gaps for `deployments/arc-testnet-journey.json`.
 * These are not Instant/Fair execution failures. `claimedArcTestnet` may stay
 * true for the recorded LOCAL authorize explorer path. Do not treat an empty
 * `blockers` array as "no gaps" while `note` / `authorizeEnv` document LOCAL.
 */
export const SUPERSEDED_TESTNET = {
  guardian: "0x2CdF37541256749E5CF6ac5C806e0d23A685F224",
  factory: "0xB48D1B397834eBcccb8961041d827487097e0535",
  lostKey: "0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E",
} as const;

/** Public isolated-path roles. Targets — on-chain launch/pricing still equal keeper until HW genesis. */
export const ISOLATED_PROD_ROLES = {
  expectedSafe: "0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406",
  launchSigner: "0xd880BD31948Ffc89E8D26C6ac90f98F825E56E9e",
  pricingSigner: "0x346363d14E6Acf1b05CA8Aa22F7E06a201A69a76",
  keeper: "0xf2105235d0a74969f229deb72d3C8C578643147F",
  deployer: "0x3E00CE2Dc40FaFB0D2dA4A5e6004278Fdf65AAF5",
} as const;

export const ISOLATED_PROD_CONTRACTS = {
  guardian: "0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934",
  factory: "0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA",
  firstCreateTx: "0x7955fda2d6a590d83e188daa509a7112ddb70bc126e325a5bd644761d0921e27",
  lastCreateTx: "0x051641005b9193f512cbf30d600f1e24b6ab038daac6b19015e8cd7b5de71ee5",
} as const;

export const PUBLIC_WEB_ENV = {
  NEXT_PUBLIC_WALLETCONNECT_ID: "f7366a56987b5b93b9dd8099f8e5b419",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAEyd86VMZKBjIeLX",
} as const;

export const LOCAL_AUTHORIZE_STANDING_BLOCKERS = [
  "authorizeEnv is LOCAL — REACTOR_ENV=PROD was not used",
  "no Cloudflare Turnstile (LOCAL indexer authorize skips CHALLENGE)",
  "PRICING_SIGNER_PK is the disposable deployer EOA / on-chain LaunchSigner — not an isolated signer ≠ deployer ≠ Keeper",
  "Instant/Fair quote is Mock USDC-6 0x44CBe037ABFA8696E4466cA9D278Dbbe44B932dC, not canonical 0x3600000000000000000000000000000000000000",
  "not production Next + wallet harness (scripted LOCAL indexer; wagmi injected() only; no WalletConnect)",
  "Guardian/Keeper/LaunchSigner are not a production Safe",
  "Not full PROD — claimedArcTestnet records the LOCAL authorize Instant/Fair explorer path only",
  "SUPERSEDED / non-PROD-isolated — Factory 0xB48D1B397834eBcccb8961041d827487097e0535 / Guardian 0x2CdF37541256749E5CF6ac5C806e0d23A685F224 have immutable guardian() = lost disposable 0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E (cannot rotate). Davis chose REDEPLOY.",
  "claimedProdPath stays false until Instant/Fair smoke on the NEW deploy + Turnstile + wallet UI ACs land",
] as const;

export function mergeJourneyStandingBlockers(existing: string[] = []): string[] {
  const out = [...existing];
  for (const b of LOCAL_AUTHORIZE_STANDING_BLOCKERS) {
    if (!out.includes(b)) out.push(b);
  }
  return out;
}

export function waitingAddressFromEnv(env: NodeJS.ProcessEnv = process.env): `0x${string}` | undefined {
  const a = env.ARC_TESTNET_ADDRESS ?? env.ARC_TESTNET_DEPLOYER;
  if (a && /^0x[a-fA-F0-9]{40}$/.test(a)) return a as `0x${string}`;
  return undefined;
}

export type ProdPathReport = {
  claimedProdPath: false;
  claimedDump: boolean;
  verificationUrl?: string;
  chainId?: number;
  factoryCodeBytes?: number;
  deployerBalanceWei?: string;
  indexerProdStart?: { ok: false; detail: string };
  gateFailures: string[];
  blockers: string[];
  notes: string[];
};

/** Honest PROD-path inventory. Never sets claimedProdPath. */
export function assembleProdPathReport(input: {
  claimedDump: boolean;
  verificationUrl?: string;
  chainId?: number;
  factoryCodeBytes?: number;
  deployerBalanceWei?: string;
  indexerProdStart?: { ok: false; detail: string };
  gateFailures: string[];
  launchSignerIsDeployer: boolean;
  keeperIsDeployer: boolean;
  walletConnectConfigured: boolean;
}): ProdPathReport {
  const blockers: string[] = [];
  if (!input.claimedDump) blockers.push("no claimed deployments/arc-testnet.json + verificationUrl");
  for (const f of input.gateFailures) blockers.push(`PROD hard gate: ${f}`);
  if (input.launchSignerIsDeployer) {
    blockers.push(
      "on-chain LaunchSigner/PricingSigner is the funded deployer EOA — isolated signer ≠ deployer needs Guardian setPricingSigner before PROD authorize",
    );
  }
  if (input.keeperIsDeployer) {
    blockers.push("on-chain Keeper is the funded deployer EOA — launch signer must not reuse the keeper key");
  }
  if (!input.walletConnectConfigured) {
    blockers.push("NEXT_PUBLIC_WALLETCONNECT_ID unset; Next connectors are wagmi injected() only — this VM has no browser wallet");
  }
  if (input.indexerProdStart && !input.indexerProdStart.ok) {
    blockers.push(`PROD indexer refuse start: ${input.indexerProdStart.detail}`);
  }
  blockers.push("no Safe genesis (Guardian is not a production Safe)");
  blockers.push("Circle faucet automation still RECAPTCHA_ERROR — not a PROD gate, funding is already on-chain");
  blockers.push(
    "SUPERSEDED / non-PROD-isolated — ReactorGuardian 0x2CdF37541256749E5CF6ac5C806e0d23A685F224 and Factory 0xB48D1B397834eBcccb8961041d827487097e0535 have immutable guardian() = lost disposable 0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E. Cannot rotate. Davis chose REDEPLOY.",
  );
  blockers.push(
    "SAFE_GENESIS constructors live (Guardian 0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934 / Factory 0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA) — HW genesis not done; on-chain launchSigner/pricingSigner still=keeper; Instant/Fair smoke not recorded",
  );
  blockers.push("claimedProdPath stays false until Instant/Fair smoke on the NEW deploy + Turnstile + wallet UI ACs land");
  const notes = [
    "LOCAL authorize Instant RHRSL + Fair RHRFL is recorded on the SUPERSEDED dump. That is not full PROD and not the isolated path.",
    "Do not set SIGNER_INLINE in PROD. Do not reuse Anvil #0. Do not invent Turnstile secrets, HMAC, signer PKs, or Sentry DSN.",
    "Public env only: NEXT_PUBLIC_WALLETCONNECT_ID and NEXT_PUBLIC_TURNSTILE_SITE_KEY are in deployments/arc-testnet.env.example. TURNSTILE_SECRET stays host-only.",
    "Target roles (not contract addresses): EXPECTED_SAFE/GUARDIAN 0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406, LaunchSigner 0xd880BD31948Ffc89E8D26C6ac90f98F825E56E9e, PricingSigner 0x346363d14E6Acf1b05CA8Aa22F7E06a201A69a76, Keeper 0xf2105235d0a74969f229deb72d3C8C578643147F.",
    "SAFE_GENESIS constructors are live (Guardian 0xc04ceecDC38e73c52aB6c3Cdc6552Be089d3a934 / Factory 0x94a6DBEB77E346BA7c7532DA01c11DB14A3b95CA). Davis HW-signs genesis as EOA EXPECTED_SAFE (no Gnosis Safe this round). pauseLaunches(false) LAST after VerifyGenesis.",
    "claimedProdPath stays false until Instant/Fair smoke on the NEW deploy + Turnstile + wallet UI ACs are human-confirmed.",
  ];
  return {
    claimedProdPath: false,
    claimedDump: input.claimedDump,
    verificationUrl: input.verificationUrl,
    chainId: input.chainId,
    factoryCodeBytes: input.factoryCodeBytes,
    deployerBalanceWei: input.deployerBalanceWei,
    indexerProdStart: input.indexerProdStart,
    gateFailures: input.gateFailures,
    blockers,
    notes,
  };
}
