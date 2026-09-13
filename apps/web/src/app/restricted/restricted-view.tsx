"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useOperatorPolicy } from "@/components/operator-policy-provider";
import {
  OPERATOR_POLICY_DISCLAIMER,
  RESTRICTED_DISCLOSURE,
  RESTRICTED_PAGE_COPY,
  restrictedDisplayKind,
  type RestrictedUxKind,
} from "@/lib/operator-policy";

/**
 * Client view for `/restricted`. `initialKind` comes from the server page's
 * request `searchParams` so SSR and the first client render match. Do not read
 * the URL during render here — a text Suspense fallback vs this tree is React
 * #418 (hydration text/HTML) under production `next start`.
 */
export function RestrictedView({ initialKind }: { initialKind?: RestrictedUxKind }) {
  const policy = useOperatorPolicy();
  const display = restrictedDisplayKind(policy.kind, initialKind);
  const live = restrictedDisplayKind(policy.kind, undefined);
  const copy = display ? RESTRICTED_PAGE_COPY[display] : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="rx-kicker">Access</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          {copy?.title ?? "REACTOR-operated access"}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-300" data-testid="restricted-lead">
          {copy?.lead ??
            "REACTOR-operated services can refuse a request, account, or location. Public market data and documentation stay readable. This page does not accuse anyone of unlawful conduct."}
        </p>
      </div>

      {live ? (
        <Card className="border-amber-300/20 bg-amber-300/8 p-4 text-[13px] text-amber-50" data-testid="restricted-live">
          <p>{policy.userMessage}</p>
          <p className="mt-2 text-[12px] text-amber-100/75">
            Launch, trade, quote-ticket, and other operated writes are disabled in this UI. Connecting a wallet will
            not prompt a transaction while this state is active.
          </p>
        </Card>
      ) : (
        <p className="text-[13px] text-zinc-400">
          This request is not currently blocked by the launchpad. The notes below still apply if a later server
          decision refuses an operated write.
        </p>
      )}

      <Card className="space-y-3 p-5 text-[14px] leading-relaxed text-zinc-300">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-400">Why this can happen</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-white">Account.</span> The hosted wallet-list check refused this account for
            operated services.
          </li>
          <li>
            <span className="text-white">Location.</span> The hosted geographic policy refused this request location.
          </li>
          <li>
            <span className="text-white">Temporarily unavailable.</span> Required access checks could not run, so
            operated writes fail closed until they return.
          </li>
        </ul>
        <p className="text-[12px] text-zinc-400">
          The UI names only these three states. It does not show IP addresses, screening-entry details, or other
          internal records.
        </p>
      </Card>

      <Card className="space-y-4 p-5 text-[14px] leading-relaxed text-zinc-300">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-400">What these controls are</h2>
        <ul className="list-disc space-y-2 pl-5">
          {RESTRICTED_DISCLOSURE.whatExists.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-400">What they cannot do</h2>
        <ul className="list-disc space-y-2 pl-5">
          {RESTRICTED_DISCLOSURE.whatCannot.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-[12px] text-zinc-400">{OPERATOR_POLICY_DISCLAIMER}</p>
      </Card>

      <div className="flex flex-wrap gap-3 text-[13px]">
        <Link href="/" className="rounded-[4px] border border-white/10 bg-white/8 px-4 py-2 text-white hover:bg-white/12">
          Public markets
        </Link>
        <Link href="/docs" className="rounded-[4px] border border-white/10 bg-white/8 px-4 py-2 text-white hover:bg-white/12">
          Docs
        </Link>
        <Link href="/docs/restricted-access" className="rounded-[4px] border border-white/10 bg-white/8 px-4 py-2 text-white hover:bg-white/12">
          Access disclosure
        </Link>
      </div>
    </div>
  );
}
