"use client";

import Link from "next/link";
import { restrictedHref } from "@/lib/operator-policy";
import { useOperatorPolicy } from "./operator-policy-provider";

export function RestrictedNotice({ className }: { className?: string }) {
  const policy = useOperatorPolicy();
  if (policy.kind === "allow" || policy.kind === "pending") return null;
  return (
    <div
      data-testid="restricted-notice"
      className={
        className ??
        "rounded-[4px] border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-[13px] text-amber-50"
      }
    >
      <p>{policy.userMessage}</p>
      <p className="mt-2 text-[12px] text-amber-100/80">
        Launch, trade, and other operated writes stay disabled. Public market and docs pages remain readable.{" "}
        <Link href={restrictedHref(policy.kind)} className="underline underline-offset-2">
          Restricted access
        </Link>
      </p>
    </div>
  );
}
