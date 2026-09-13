import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/nav";
import { NetworkBanner } from "@/components/network-banner";
import { QaInjectBar } from "@/components/qa-inject-bar";
import { QaInjectProvider } from "@/components/qa-inject-provider";
import { RestrictedBanner } from "@/components/restricted-banner";
import { LiveToastProvider } from "@/components/live-toasts";
import { LiveCacheProvider } from "@/lib/sse";
import { releaseInfo } from "@/lib/obs/release";
import { BRAND_COPY } from "@/lib/brand";

const rel = releaseInfo();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://reactor.markets"),
  title: {
    default: BRAND_COPY.title,
    template: "%s · REACTOR",
  },
  description: BRAND_COPY.description,
  applicationName: BRAND_COPY.product,
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: BRAND_COPY.ogTitle,
    description: BRAND_COPY.ogDescription,
    siteName: BRAND_COPY.product,
    images: [{ url: "/og/default.png", width: 1200, height: 630, alt: BRAND_COPY.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND_COPY.ogTitle,
    description: BRAND_COPY.ogDescription,
    images: ["/og/default.png"],
  },
  other: {
    "msapplication-TileColor": "#12110f",
    "reactor-release": rel.release,
    "reactor-build-sha": rel.buildSha,
    "reactor-protocol": rel.protocolVersion,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="en" data-csp-nonce={nonce}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <a href="#content" className="skip-link">
            Skip to main content
          </a>
          <NetworkBanner />
          <RestrictedBanner />
          <Suspense fallback={null}>
            <QaInjectProvider>
              <LiveCacheProvider>
                <LiveToastProvider>
                  <QaInjectBar />
                  <Nav />
                  <main
                    id="content"
                    tabIndex={-1}
                    className="mx-auto min-h-[calc(100vh-8rem)] max-w-7xl px-4 py-5 sm:py-6 outline-none"
                  >
                    {children}
                  </main>
                  <footer
                    className="border-t border-white/8 px-4 py-6 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-rx-muted"
                    title={rel.release}
                    data-release={rel.release}
                  >
                    REACTOR · Token launch on Arc · Not audited · Test / local only
                  </footer>
                </LiveToastProvider>
              </LiveCacheProvider>
            </QaInjectProvider>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
