import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchpadSecurityHeaders } from "./src/lib/security-headers";

function gitSha(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

function protocolVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const ver = JSON.parse(readFileSync(join(root, "docs/version.json"), "utf8")) as { protocolVersion: string };
    return ver.protocolVersion;
  } catch {
    return process.env.NEXT_PUBLIC_PROTOCOL_VERSION || "0.0.0";
  }
}

function buildTime(): string {
  return process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString();
}

const buildSha = gitSha();
const proto = protocolVersion();
const builtAt = buildTime();
const chainIdPublic = process.env.NEXT_PUBLIC_CHAIN_ID || "5042002";
const chainNamePublic = process.env.NEXT_PUBLIC_CHAIN_NAME || "REACTOR local (Arc-compatible)";
process.env.NEXT_PUBLIC_BUILD_SHA = buildSha;
process.env.NEXT_PUBLIC_PROTOCOL_VERSION = proto;
process.env.NEXT_PUBLIC_BUILD_TIME = builtAt;
process.env.NEXT_PUBLIC_CHAIN_ID = chainIdPublic;
process.env.NEXT_PUBLIC_CHAIN_NAME = chainNamePublic;
const uploadMaps = Boolean(process.env.SENTRY_AUTH_TOKEN) || process.env.REACTOR_SOURCEMAPS === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@reactor/core"],
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha,
    NEXT_PUBLIC_PROTOCOL_VERSION: proto,
    NEXT_PUBLIC_RELEASE: `reactor@${proto}+${buildSha}`,
    NEXT_PUBLIC_BUILD_TIME: builtAt,
    NEXT_PUBLIC_CHAIN_ID: chainIdPublic,
    NEXT_PUBLIC_CHAIN_NAME: chainNamePublic,
  },
  // Maps are generated for Sentry-or-equivalent upload. middleware 404s public .map in production.
  productionBrowserSourceMaps: uploadMaps,
  webpack: uploadMaps
    ? (config, { dev }) => {
        if (!dev) config.devtool = "hidden-source-map";
        return config;
      }
    : undefined,
  async headers() {
    // Static headers only. CSP is nonce'd per request in src/middleware.ts.
    return [
      {
        source: "/:path*",
        headers: launchpadSecurityHeaders(),
      },
      {
        source: "/:path*.map",
        headers: [
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
