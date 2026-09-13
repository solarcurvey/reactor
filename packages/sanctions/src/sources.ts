import type { OfficialSource } from "./types.ts";

/**
 * Documented official U.S. Treasury / OFAC machine-readable list files.
 *
 * Source of truth for URLs:
 * - https://ofac.treasury.gov/specially-designated-nationals-list-data-formats-data-schemas
 * - https://ofac.treasury.gov/faqs/topic/1626 (digital currency address field shape)
 *
 * Fetch only these HTTPS hosts. Third-party mirrors are not a source of truth.
 */
export const OFFICIAL_OFAC_DOCUMENTATION = {
  formats:
    "https://ofac.treasury.gov/specially-designated-nationals-list-data-formats-data-schemas",
  digitalCurrencyFaq: "https://ofac.treasury.gov/faqs/topic/1626",
  downloadsRoot: "https://www.treasury.gov/ofac/downloads/",
} as const;

export const OFFICIAL_SOURCE_HOSTS = new Set([
  "www.treasury.gov",
  "ofac.treasury.gov",
  "sanctionslistservice.ofac.treas.gov",
]);

export const OFFICIAL_SOURCES: readonly OfficialSource[] = [
  {
    id: "ofac-sdn-xml",
    url: "https://www.treasury.gov/ofac/downloads/sdn.xml",
    format: "sdn_xml",
    publisher: "U.S. Department of the Treasury / OFAC",
    documentation: OFFICIAL_OFAC_DOCUMENTATION.formats,
  },
  {
    id: "ofac-sdn-advanced-xml",
    url: "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml",
    format: "sdn_advanced_xml",
    publisher: "U.S. Department of the Treasury / OFAC",
    documentation: OFFICIAL_OFAC_DOCUMENTATION.formats,
  },
  {
    id: "ofac-consolidated-xml",
    url: "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml",
    format: "consolidated_xml",
    publisher: "U.S. Department of the Treasury / OFAC",
    documentation: OFFICIAL_OFAC_DOCUMENTATION.formats,
  },
  {
    id: "ofac-consolidated-advanced-xml",
    url: "https://www.treasury.gov/ofac/downloads/sanctions/1.0/cons_advanced.xml",
    format: "consolidated_advanced_xml",
    publisher: "U.S. Department of the Treasury / OFAC",
    documentation: OFFICIAL_OFAC_DOCUMENTATION.formats,
  },
];

/**
 * Canonical production refresh set: SDN + Consolidated (classic and advanced).
 * Same canonical key is merged once across files — no double-count identity.
 */
export const DEFAULT_REFRESH_SOURCE_IDS = [
  "ofac-sdn-xml",
  "ofac-sdn-advanced-xml",
  "ofac-consolidated-xml",
  "ofac-consolidated-advanced-xml",
] as const;

export function officialSourceById(id: string): OfficialSource | undefined {
  return OFFICIAL_SOURCES.find((s) => s.id === id);
}

export function assertOfficialSourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`official OFAC fetch requires HTTPS: ${raw}`);
  }
  if (url.username || url.password) {
    throw new Error(`official OFAC fetch rejects userinfo: ${url.host}`);
  }
  if (!OFFICIAL_SOURCE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`host is not an official Treasury/OFAC source: ${url.hostname}`);
  }
  return url;
}
