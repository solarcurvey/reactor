import { NextResponse } from "next/server";
import { releaseInfo } from "../../../lib/obs/release";

export const dynamic = "force-dynamic";

/** Public build identity. No secrets. Used by ops and release telemetry. */
export async function GET() {
  const rel = releaseInfo();
  return NextResponse.json({
    ok: true,
    protocolVersion: rel.protocolVersion,
    releaseTag: rel.releaseTag,
    factoryVersion: rel.factoryVersion,
    factoryVersionLabel: rel.factoryVersionLabel,
    buildSha: rel.buildSha,
    release: rel.release,
    env: rel.env,
    reactorEnv: rel.reactorEnv,
    chainId: rel.chainId,
    chainName: rel.chainName,
    buildTimestamp: rel.buildTimestamp,
    sentry: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
    mainnet: false,
    audited: false,
  });
}
