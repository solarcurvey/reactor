import { NextResponse, type NextRequest } from "next/server";
import { applyLaunchpadHeaders, contentSecurityPolicy } from "@/lib/security-headers";

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const production = process.env.NODE_ENV === "production";
  const csp = contentSecurityPolicy({ nonce, production });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  applyLaunchpadHeaders(response.headers, csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
