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
import { LiveToastProvider } from "@/components/live-toasts";
import { LiveCacheProvider } from "@/lib/sse";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "REACTOR — Token launch on Arc",
  description: "Launch markets that pay holders. Official REACTOR pools on Arc. Not an AI trading terminal.",
  applicationName: "REACTOR",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/brand/mark.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "REACTOR",
    description: "Token launch markets on Arc. Launch. Reflect. Burn.",
    siteName: "REACTOR",
    images: [{ url: "/brand/og-default.png", width: 1200, height: 630, alt: "REACTOR — Token launch on Arc" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "REACTOR — Token launch on Arc",
    description: "Launch markets that pay holders. Official REACTOR pools on Arc.",
    images: ["/brand/og-default.png"],
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
                  <footer className="border-t border-rx-steel px-4 py-6 text-center text-[11px] uppercase tracking-[0.12em] text-rx-cool">
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
