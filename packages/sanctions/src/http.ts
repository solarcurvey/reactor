import { SCREEN_DISCLAIMER, type AddressFamily, type ScreenResult } from "./types.ts";
import type { SanctionsStore } from "./store.ts";
import type { RefreshOpts, RefreshResult } from "./refresh.ts";

export type SanctionsJson = Record<string, unknown>;

const FAMILIES = new Set<AddressFamily>([
  "evm",
  "btc",
  "ltc",
  "bch",
  "xrp",
  "xmr",
  "sol",
  "trx",
  "dash",
  "zec",
  "doge",
  "other",
]);

export function screenToJson(result: ScreenResult, extra?: SanctionsJson): SanctionsJson {
  return {
    decision: result.decision,
    reason: result.reason ?? null,
    freshness: result.freshness,
    datasetVersion: result.datasetVersion,
    match: result.match,
    disclaimer: result.disclaimer,
    ...extra,
  };
}

export function handleSanctionsRequest(
  store: SanctionsStore,
  req: { method?: string; pathname: string; searchParams: URLSearchParams },
  opts: { refresh?: (store: SanctionsStore, refreshOpts?: RefreshOpts) => Promise<RefreshResult> } = {},
): { status: number; body: SanctionsJson } {
  if (req.pathname === "/sanctions/dataset" && (req.method ?? "GET") === "GET") {
    const active = store.active();
    return {
      status: 200,
      body: {
        freshness: store.freshness(),
        datasetVersion: active?.version ?? null,
        addressCount: active?.version.addressCount ?? 0,
        disclaimer: SCREEN_DISCLAIMER,
        // RELEASE GATE #60 children (not #61): server policy gate, geo/IP, UX.
        policyGate: null,
      },
    };
  }

  if (req.pathname === "/sanctions/screen" && (req.method ?? "GET") === "GET") {
    const address = req.searchParams.get("address") ?? "";
    const familyRaw = req.searchParams.get("family");
    if (!address.trim()) {
      return { status: 400, body: { error: "address required", disclaimer: SCREEN_DISCLAIMER } };
    }
    let family: AddressFamily | undefined;
    if (familyRaw) {
      if (!FAMILIES.has(familyRaw as AddressFamily)) {
        return { status: 400, body: { error: "unknown family", disclaimer: SCREEN_DISCLAIMER } };
      }
      family = familyRaw as AddressFamily;
    }
    return { status: 200, body: screenToJson(store.screen(address, { family })) };
  }

  if (req.pathname === "/ops/sanctions/refresh" && req.method === "POST") {
    if (!opts.refresh) {
      return { status: 501, body: { error: "refresh not mounted", disclaimer: SCREEN_DISCLAIMER } };
    }
    return {
      status: 202,
      body: { accepted: true, note: "caller must await refreshSanctions(); this helper is sync-shaped" },
    };
  }

  return { status: 404, body: { error: "not found" } };
}

/** Later #60 children consume this. #61 only exposes lookup + version. */
export const RELEASE_GATE_60_CHILDREN = [
  "server policy gate (deny launch/trade on blocked; fail-closed on unavailable)",
  "geo/IP controls",
  "UX copy for blocked / unavailable",
] as const;
