"use client";

import { useEffect } from "react";
import { reportFailure, releaseInfo } from "@/lib/obs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportFailure("ui", error, { digest: error.digest, boundary: "global" });
  }, [error]);
  const rel = releaseInfo();
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0d10", color: "#f4f7fb", fontFamily: "ui-sans-serif, system-ui" }}>
        <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#7ee8ff" }}>
            Root error
          </p>
          <h1 style={{ fontSize: 28, margin: "0.5rem 0 0" }}>REACTOR hit a root render failure</h1>
          <p style={{ color: "#a1a1aa", fontSize: 14 }}>
            No transaction was submitted from this screen. Release {rel.release}.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              border: 0,
              borderRadius: 999,
              background: "#7ee8ff",
              color: "#0b0d10",
              padding: "10px 18px",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
