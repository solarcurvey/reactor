/**
 * Trusted geo extraction (issue #63).
 *
 * Production accepts country/region only from a verified reverse-proxy /
 * deployment-edge HMAC claim. Browser-supplied CF-IPCountry, X-Country,
 * CloudFront-Viewer-Country, and similar headers are ignored.
 *
 * LOCAL/test may use an in-process fixture claim or `x-reactor-geo-fixture`.
 * Production never honors fixture headers.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { productionHardGatesApply } from "./prod-gates.ts";
import {
  NONE_ANONYMIZER,
  createFixtureClaim,
  type AnonymizerAssessment,
  type AnonymizerKind,
  type GeoClaimSource,
  type TrustedGeoClaim,
} from "../../../packages/reactor/src/geo-policy.ts";

export const GEO_CLAIM_VERSION = "v1";
export const DEFAULT_GEO_MAX_SKEW_SEC = 90;

export const UNTRUSTED_GEO_HEADER_NAMES = [
  "cf-ipcountry",
  "cf-ipcity",
  "cf-region",
  "cf-region-code",
  "cf-connecting-ip",
  "x-country",
  "x-country-code",
  "x-geo-country",
  "x-appengine-country",
  "x-vercel-ip-country",
  "x-forwarded-country",
  "cloudfront-viewer-country",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

export type HeaderMap = Record<string, string | string[] | undefined>;

export type GeoTrustFailure =
  | "none"
  | "untrusted"
  | "invalid"
  | "stale"
  | "missing";

export type GeoTrustResult =
  | { ok: true; claim: TrustedGeoClaim }
  | { ok: false; missing: GeoTrustFailure; ignored: string[] };

function header(headers: HeaderMap, name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return v == null ? "" : String(v).trim();
}

function presentUntrusted(headers: HeaderMap): string[] {
  return UNTRUSTED_GEO_HEADER_NAMES.filter((n) => header(headers, n));
}

function parseAnonymizer(raw: string): AnonymizerAssessment {
  const t = raw.trim().toLowerCase();
  const kind: AnonymizerKind =
    t === "suspected_tor" || t === "tor"
      ? "tor"
      : t === "suspected_proxy" || t === "proxy"
        ? "proxy"
        : t === "suspected_vpn" || t === "vpn"
          ? "vpn"
          : t === "none" || t === ""
            ? "none"
            : "unknown";
  return {
    suspected: kind !== "none",
    kind,
    confidence: "best_effort",
  };
}

export function geoMacPayload(parts: {
  ts: string;
  country: string;
  region: string;
  regionName: string;
  anonymizer: string;
  ip: string;
}): string {
  return [GEO_CLAIM_VERSION, parts.ts, parts.country, parts.region, parts.regionName, parts.anonymizer, parts.ip].join(
    "\n",
  );
}

export function signGeoClaim(
  secret: string,
  parts: { ts: string; country: string; region: string; regionName?: string; anonymizer: string; ip: string },
): string {
  return createHmac("sha256", secret)
    .update(geoMacPayload({ ...parts, regionName: parts.regionName ?? "" }))
    .digest("hex");
}

function macEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseCompact(raw: string): {
  ts: string;
  country: string;
  region: string;
  anonymizer: string;
  mac: string;
} | null {
  const parts = raw.split(".");
  if (parts.length !== 6) return null;
  const [ver, ts, country, region, anonymizer, mac] = parts;
  if (ver !== GEO_CLAIM_VERSION) return null;
  if (!ts || !mac) return null;
  return { ts, country, region, anonymizer, mac };
}

export function readTrustedGeo(
  headers: HeaderMap,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): GeoTrustResult {
  const ignored = presentUntrusted(headers);
  const prod = productionHardGatesApply(env);

  if (!prod) {
    const fixture = header(headers, "x-reactor-geo-fixture");
    if (fixture) {
      let country = fixture;
      let region = "";
      let regionName = "";
      let anonymizerRaw = "";
      if (fixture.includes("=") || fixture.includes(";")) {
        const fields = Object.fromEntries(
          fixture.split(";").map((p) => {
            const i = p.indexOf("=");
            return i === -1 ? [p.trim().toLowerCase(), ""] : [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
          }),
        );
        country = fields.country ?? "";
        region = fields.region ?? "";
        regionName = fields.regionname ?? fields["region-name"] ?? "";
        anonymizerRaw = fields.anonymizer ?? "";
      }
      return {
        ok: true,
        claim: createFixtureClaim({
          country: country || undefined,
          region: region || undefined,
          regionName: regionName || undefined,
          anonymizer: parseAnonymizer(anonymizerRaw),
          observedAtMs: nowMs,
        }),
      };
    }
    return { ok: false, missing: ignored.length ? "untrusted" : "missing", ignored };
  }

  const secret = env.GEO_EDGE_SECRET?.trim() ?? "";
  if (secret.length < 16) {
    return { ok: false, missing: "untrusted", ignored };
  }

  // Fixture headers are never production geo.
  if (header(headers, "x-reactor-geo-fixture")) {
    return { ok: false, missing: "untrusted", ignored: [...ignored, "x-reactor-geo-fixture"] };
  }

  let ts = header(headers, "x-reactor-geo-ts");
  let country = header(headers, "x-reactor-geo-country");
  let region = header(headers, "x-reactor-geo-region");
  let anonymizer = header(headers, "x-reactor-geo-anonymizer");
  let ip = header(headers, "x-reactor-geo-ip");
  let mac = header(headers, "x-reactor-geo-mac");
  let regionName = header(headers, "x-reactor-geo-region-name");
  const compact = header(headers, "x-reactor-geo");
  if (compact) {
    const parsed = parseCompact(compact);
    if (!parsed) return { ok: false, missing: "invalid", ignored };
    ts = parsed.ts;
    country = parsed.country;
    region = parsed.region;
    anonymizer = parsed.anonymizer;
    mac = parsed.mac;
    regionName = "";
  }

  if (!mac && !ts && !country) {
    return { ok: false, missing: ignored.length ? "untrusted" : "missing", ignored };
  }
  if (!mac || !ts) return { ok: false, missing: "invalid", ignored };

  const expected = signGeoClaim(secret, { ts, country, region, regionName, anonymizer, ip });
  if (!macEqual(mac, expected)) return { ok: false, missing: "untrusted", ignored };

  const tsSec = Number(ts);
  if (!Number.isFinite(tsSec) || tsSec <= 0) return { ok: false, missing: "invalid", ignored };
  const skew = Number(env.GEO_EDGE_MAX_SKEW_SEC ?? DEFAULT_GEO_MAX_SKEW_SEC);
  const maxSkew = Number.isFinite(skew) && skew > 0 ? skew : DEFAULT_GEO_MAX_SKEW_SEC;
  if (Math.abs(nowMs / 1000 - tsSec) > maxSkew) return { ok: false, missing: "stale", ignored };

  const source: GeoClaimSource =
    (env.GEO_EDGE_KIND ?? "").toLowerCase() === "deployment_edge"
      ? "deployment_edge"
      : "verified_reverse_proxy";

  return {
    ok: true,
    claim: {
      source,
      country: country || undefined,
      region: region || undefined,
      regionName: regionName || undefined,
      clientIp: ip || undefined,
      anonymizer: parseAnonymizer(anonymizer),
      observedAtMs: tsSec * 1000,
    },
  };
}
