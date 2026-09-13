import version from "../../../../../docs/version.json";
import deployment from "../deployment.json";

export const EXPECTED_CHAIN_ID = 5042002;
export const LOCAL_CHAIN_NAME = "REACTOR local (Arc-compatible)";
export const TESTNET_CHAIN_NAME = "Arc Public Testnet";

export type ReleaseInfo = {
  protocolVersion: string;
  releaseTag: string;
  factoryVersion: number;
  factoryVersionLabel: string;
  buildSha: string;
  release: string;
  env: string;
  reactorEnv: string;
  chainId: number;
  chainName: string;
  buildTimestamp: string;
};

/**
 * Next only inlines `process.env.NEXT_PUBLIC_*` as a static member expression.
 * Dynamic `process.env[name]` stays empty in the browser bundle.
 */
function publicBuildSha(): string | undefined {
  const v = process.env.NEXT_PUBLIC_BUILD_SHA;
  return v && v.length ? v : undefined;
}
function publicProtocol(): string | undefined {
  const v = process.env.NEXT_PUBLIC_PROTOCOL_VERSION;
  return v && v.length ? v : undefined;
}
function publicReactorEnv(): string | undefined {
  const v = process.env.NEXT_PUBLIC_REACTOR_ENV;
  return v && v.length ? v : undefined;
}
function publicChainId(): string | undefined {
  const v = process.env.NEXT_PUBLIC_CHAIN_ID;
  return v && v.length ? v : undefined;
}
function publicChainName(): string | undefined {
  const v = process.env.NEXT_PUBLIC_CHAIN_NAME;
  return v && v.length ? v : undefined;
}
function publicBuildTime(): string | undefined {
  const v = process.env.NEXT_PUBLIC_BUILD_TIME;
  return v && v.length ? v : undefined;
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

export function buildSha(): string {
  return (
    publicBuildSha() ??
    readEnv("GITHUB_SHA") ??
    readEnv("VERCEL_GIT_COMMIT_SHA") ??
    readEnv("CF_PAGES_COMMIT_SHA") ??
    "dev"
  );
}

export function protocolVersion(): string {
  return publicProtocol() ?? version.protocolVersion;
}

export function runtimeEnv(): string {
  return (publicReactorEnv() ?? readEnv("REACTOR_ENV") ?? readEnv("NODE_ENV") ?? "local").toLowerCase();
}

/** Exact operator tag: LOCAL | TESTNET | PROD | TEST. */
export function reactorEnv(): string {
  const explicit = (publicReactorEnv() ?? readEnv("REACTOR_ENV") ?? "").toUpperCase();
  if (explicit === "PROD" || explicit === "TESTNET" || explicit === "LOCAL") return explicit;
  const node = (readEnv("NODE_ENV") ?? "").toLowerCase();
  if (node === "test") return "TEST";
  if (node === "production") return "PROD";
  return "LOCAL";
}

export function chainId(): number {
  const fromEnv = publicChainId();
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  return typeof deployment.chainId === "number" ? deployment.chainId : EXPECTED_CHAIN_ID;
}

export function chainName(): string {
  const fromEnv = publicChainName();
  if (fromEnv) return fromEnv;
  return deployment.claimedArcTestnet ? TESTNET_CHAIN_NAME : LOCAL_CHAIN_NAME;
}

export function buildTimestamp(): string {
  return publicBuildTime() ?? "";
}

export function releaseId(sha = buildSha(), proto = protocolVersion()): string {
  return `reactor@${proto}+${sha}`;
}

export function releaseInfo(): ReleaseInfo {
  const sha = buildSha();
  const proto = protocolVersion();
  return {
    protocolVersion: proto,
    releaseTag: version.releaseTag,
    factoryVersion: version.factoryVersion,
    factoryVersionLabel: version.factoryVersionLabel,
    buildSha: sha,
    release: releaseId(sha, proto),
    env: runtimeEnv(),
    reactorEnv: reactorEnv(),
    chainId: chainId(),
    chainName: chainName(),
    buildTimestamp: buildTimestamp(),
  };
}

export function shortSha(sha = buildSha()): string {
  if (sha === "dev") return "dev";
  return sha.length > 12 ? sha.slice(0, 12) : sha;
}
