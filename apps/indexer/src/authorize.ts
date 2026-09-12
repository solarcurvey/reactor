import type { Store } from "./db.ts";
import { admit, type AdmitInput } from "./admission.ts";
import { signAuthorized, type SignRequest } from "./launch-signer.ts";

const SIGNER_URL = process.env.PRICING_SIGNER_URL ?? "http://127.0.0.1:43149";
const INTERNAL = process.env.SIGNER_INTERNAL_TOKEN ?? (process.env.REACTOR_ENV?.toUpperCase() === "LOCAL" ? "local-internal-signer" : "");

export async function authorizeLaunch(store: Store, input: AdmitInput & SignRequest) {
  const admitted = await admit(store, input);
  if (admitted.decision === "DENY") {
    return { status: 403 as const, body: { ...admitted, error: admitted.reasons.join(", ") || "Launch denied" } };
  }
  if (admitted.decision === "CHALLENGE") {
    return {
      status: 403 as const,
      body: {
        ...admitted,
        error: "CHALLENGE — complete Turnstile before authorization. CHALLENGE is not ALLOW.",
      },
    };
  }
  if (!admitted.receipt) {
    return { status: 403 as const, body: { ...admitted, error: "admission receipt missing" } };
  }

  const payload: SignRequest = {
    quote: input.quote,
    creator: input.wallet ?? input.creator,
    ticker: admitted.ticker,
    mode: input.mode,
    name: input.name,
    image: input.image,
    description: input.description,
    website: input.website,
    twitter: input.twitter,
    telegram: input.telegram,
    factory: input.factory,
    receipt: admitted.receipt,
  };

  const inline =
    process.env.SIGNER_INLINE === "1" ||
    process.env.SIGNER_INLINE === "true" ||
    ((process.env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL" && process.env.SIGNER_INLINE !== "0");
  if (inline) {
    const signed = await signAuthorized(store, payload, {
      receipt: admitted.receipt,
      internalToken: INTERNAL,
      remoteAddress: "127.0.0.1",
    });
    return { status: 200 as const, body: { ...signed, admission: admitted } };
  }

  const res = await fetch(SIGNER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admission-receipt": admitted.receipt,
      "x-internal-signer-token": INTERNAL,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status as 200 | 403 | 500 | 503, body: { ...json, admission: admitted } };
}
