/**
 * Exact official-list digital-currency address screening.
 * Engineering risk-reduction only — not legal/OFAC "compliance."
 * No hop / exposure / cluster attribution is claimed or computed.
 */

export const PARSER_VERSION = "1.0.0";

export type AddressFamily =
  | "evm"
  | "btc"
  | "ltc"
  | "bch"
  | "xrp"
  | "xmr"
  | "sol"
  | "trx"
  | "dash"
  | "zec"
  | "doge"
  | "other";

/** Three-way decision. Errors and staleness are never reported as `clear`. */
export type ScreenDecision = "blocked" | "clear" | "unavailable";

export type ScreenReason = "missing_dataset" | "stale_dataset" | "invalid_query" | "incompatible_parser";

export type Freshness = "current" | "stale" | "missing";

export type OfficialSourceFormat = "sdn_xml" | "sdn_advanced_xml" | "consolidated_xml" | "consolidated_advanced_xml";

export type OfficialSource = {
  id: string;
  url: string;
  format: OfficialSourceFormat;
  publisher: string;
  documentation: string;
};

export type SourceFetchMeta = {
  id: string;
  url: string;
  format: OfficialSourceFormat;
  retrievedAt: string;
  contentHash: string;
  byteLength: number;
  httpStatus: number;
  etag?: string;
  lastModified?: string;
  publishDate?: string;
  recordCount?: number;
};

export type DatasetVersion = {
  id: string;
  retrievedAt: string;
  activatedAt?: string;
  sources: SourceFetchMeta[];
  contentHash: string;
  parserVersion: string;
  addressCount: number;
  entryCount: number;
  warningCount: number;
};

export type SanctionedAddress = {
  family: AddressFamily;
  canonicalKey: string;
  display: string;
  ofacTickers: string[];
  sdnUids: string[];
  names: string[];
  sources: Array<{ sourceId: string; sourceUrl: string }>;
};

export type ParseWarning = {
  kind: "malformed_address" | "skipped_row" | "unrecognized_family" | "duplicate";
  message: string;
  sourceId?: string;
  raw?: string;
};

export type ParseResult = {
  addresses: SanctionedAddress[];
  warnings: ParseWarning[];
  publishDate?: string;
  recordCount?: number;
};

export type ScreenMatch = {
  family: AddressFamily;
  canonicalKey: string;
  display: string;
  ofacTickers: string[];
  sdnUids: string[];
  names: string[];
  sources: Array<{ sourceId: string; sourceUrl: string }>;
};

export type ScreenResult = {
  decision: ScreenDecision;
  reason?: ScreenReason;
  freshness: Freshness;
  datasetVersion: DatasetVersion | null;
  match: ScreenMatch | null;
  /**
   * Always present so callers cannot treat this as a legal opinion.
   * Exact official-list address match only.
   */
  disclaimer: string;
};

export const SCREEN_DISCLAIMER =
  "Exact official-list digital-currency address match only. Not legal or OFAC compliance. No hop, cluster, or exposure attribution.";

export type DatasetSnapshot = {
  version: DatasetVersion;
  index: Map<string, SanctionedAddress>;
};
