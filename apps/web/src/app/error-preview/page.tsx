"use client";

import { notFound } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

function PreviewInner() {
  const prod =
    (process.env.NEXT_PUBLIC_REACTOR_ENV ?? process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD" ||
    process.env.NODE_ENV === "production";
  if (prod) notFound();
  const auto = useSearchParams().get("preview") === "1";
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    if (auto) setBoom(true);
  }, [auto]);
  if (boom) throw new Error("intentional error-boundary preview (LOCAL only)");
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold">Error-boundary preview</h1>
      <p className="mt-2 text-sm text-zinc-400">
        LOCAL / non-production only. Click the button or open <code>?preview=1</code> to trip the route error boundary.
        Not in public nav. Hidden when <code>REACTOR_ENV=PROD</code> or <code>NODE_ENV=production</code>.
      </p>
      <Button className="mt-4" onClick={() => setBoom(true)}>
        Trip route boundary
      </Button>
    </div>
  );
}

export default function ErrorPreviewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">…</p>}>
      <PreviewInner />
    </Suspense>
  );
}
