import type { NextConfig } from "next";
import { launchpadSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@reactor/core"],
  async headers() {
    // Static headers only. CSP is nonce'd per request in src/middleware.ts.
    return [
      {
        source: "/:path*",
        headers: launchpadSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
