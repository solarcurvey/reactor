import { proxyLaunchAuthorize } from "../../../lib/launch-authorize-proxy";

/**
 * Public Next route never talks to the isolated signer.
 * Forwards to indexer POST /launch/authorize (admission → receipt → internal sign).
 * Body is capped (16KiB default / 64KiB hard max) before the proxy buffer so chunked oversize cannot fill the BFF.
 * Sanctions / geo policy is enforced on the indexer — this BFF does not honor client clear/country flags.
 */
export async function POST(req: Request) {
  return proxyLaunchAuthorize(req);
}
