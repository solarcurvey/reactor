import { NextResponse } from "next/server";
import { resolveOperatorPolicyStatus } from "@/lib/operator-policy-status";

export const dynamic = "force-dynamic";

/**
 * Minimized public decision for launchpad UX. Not a write. Not authority for
 * onchain calls. Extra indexer fields are stripped before they reach the browser.
 */
export async function GET(req: Request) {
  const view = await resolveOperatorPolicyStatus({ req });
  return NextResponse.json(view, {
    status: view.writesAllowed ? 200 : view.decision === "unavailable" ? 503 : 403,
    headers: {
      "cache-control": "no-store",
    },
  });
}
