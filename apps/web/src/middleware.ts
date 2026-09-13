import { NextResponse, type NextRequest } from "next/server";
import { applyLaunchpadHeaders, contentSecurityPolicy } from "@/lib/security-headers";

/** CSP + launchpad headers. Production does not serve browser source maps. */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.endsWith(".map") && process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.svg|icons/|brand/|og/|apple-touch-icon.png|site.webmanifest).*)",
    "/:path*.map",
  ],
};
