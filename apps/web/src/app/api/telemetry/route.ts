import { NextResponse } from "next/server";
import { BodyTooLargeError, readLimitedText } from "../../../lib/limited-json";
import { acceptIngestedEvent } from "../../../lib/obs/telemetry";
import { allowTelemetryIngest } from "../../../lib/obs/ingest-rate";
import { releaseInfo } from "../../../lib/obs/release";
import { postSentryStore } from "../../../lib/obs/sentry";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/**
 * Browser telemetry ingest. Re-redacts, drops residual secrets, optional Sentry forward.
 * Not an analytics warehouse. Body cap matches other public JSON POSTs.
 */
export async function POST(req: Request) {
  if (!allowTelemetryIngest(clientIp(req))) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  }
  const rel = releaseInfo();
  try {
    const text = await readLimitedText(req);
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
    }
    const event = acceptIngestedEvent(body);
    if (!event) {
      return NextResponse.json({ ok: false, error: "rejected" }, { status: 400 });
    }
    console.warn(JSON.stringify({ src: "reactor-web-ingest", ...event }));
    const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (dsn) {
      void postSentryStore(dsn, event).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, release: rel.release, buildSha: rel.buildSha });
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return NextResponse.json({ error: e.message }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: "telemetry unavailable" }, { status: 503 });
  }
}
