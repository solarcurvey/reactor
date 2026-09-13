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
      <body style={{ margin: 0, background: "#12110f", color: "#ece8e1", fontFamily: "ui-sans-serif, system-ui" }}>
        <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#ff6b2b" }}>
            Root error
          </p>
          <h1 style={{ fontSize: 28, margin: "0.5rem 0 0" }}>REACTOR hit a root render failure</h1>
          <p style={{ color: "#9aa4ad", fontSize: 14 }}>
            No transaction was submitted from this screen. Release {rel.release}.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              border: 0,
              borderRadius: 4,
              background: "#ff6b2b",
              color: "#12110f",
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
