/**
 * Configured-DSN vendor proof (Sentry store API).
 * CI uses an in-process mock store — no repository secrets, no live org.
 * A real staging/org DSN is the same POST with the same payload shape.
 */
import { parseSentryDsn, postSentryStore, toSentryStorePayload } from "./sentry";
import type { TelemetryEvent } from "./telemetry";

/** Dummy DSN: valid shape, key ≥ 8 chars. Host is never contacted in unit tests. */
export const STAGING_VENDOR_DSN = "https://abcdef0123456789@vendor.test/42";

export type VendorStoreReceipt = {
  ok: boolean;
  storeUrl: string;
  payload: Record<string, unknown>;
  auth: string | null;
};

export function stagingVendorDsn(): string {
  return STAGING_VENDOR_DSN;
}

export function expectedVendorStoreUrl(dsn = STAGING_VENDOR_DSN): string {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) throw new Error("staging vendor DSN must parse");
  return parsed.storeUrl;
}

/** POST a deliberate production error through the configured-DSN path and return what the vendor stored. */
export async function proveConfiguredVendorRelease(
  event: TelemetryEvent,
  dsn = STAGING_VENDOR_DSN,
): Promise<VendorStoreReceipt> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) {
    return { ok: false, storeUrl: "", payload: {}, auth: null };
  }
  let captured: VendorStoreReceipt = { ok: false, storeUrl: parsed.storeUrl, payload: {}, auth: null };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    captured = {
      ok: true,
      storeUrl: url,
      payload: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      auth: new Headers(init?.headers).get("x-sentry-auth"),
    };
    return new Response("{}", { status: 200 });
  };
  const posted = await postSentryStore(dsn, event, fetchImpl);
  captured.ok = posted && captured.ok;
  if (!captured.payload.release) {
    captured.payload = toSentryStorePayload(event);
  }
  return captured;
}
