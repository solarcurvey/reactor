import { mkdirSync } from "node:fs";
import {
  handleSanctionsRequest,
  openSanctionsStore,
  refreshSanctions,
  SCREEN_DISCLAIMER,
  type SanctionsStore,
} from "../../../packages/sanctions/src/index.ts";

/**
 * Exact official-list screening only (Refs #61).
 * RELEASE GATE #60 children — not implemented here:
 * - server policy gate (do not deny launch/trade from this module)
 * - geo/IP controls
 * - UX copy
 */
export function indexerSanctionsStore(): SanctionsStore {
  const dataDir = process.env.SANCTIONS_DATA_DIR ?? new URL("../data/sanctions", import.meta.url).pathname;
  mkdirSync(dataDir, { recursive: true });
  return openSanctionsStore({
    dataDir,
    maxAgeMs: Number(process.env.SANCTIONS_MAX_AGE_MS ?? 7 * 24 * 60 * 60 * 1000),
  });
}

export function sanctionsLookup(
  store: SanctionsStore,
  req: { method?: string; pathname: string; searchParams: URLSearchParams },
) {
  return handleSanctionsRequest(store, req);
}

export async function opsRefreshSanctions(store: SanctionsStore) {
  return refreshSanctions(store);
}

export { SCREEN_DISCLAIMER };
