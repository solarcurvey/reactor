import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/nav";
import { NetworkBanner } from "@/components/network-banner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "REACTOR — Launch. Reflect. Burn.",
  description: "Launch markets that pay holders. Official REACTOR pools on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <NetworkBanner />
          <Nav />
          <main className="mx-auto min-h-[calc(100vh-8rem)] max-w-6xl px-4 py-8">{children}</main>
          <footer className="border-t border-white/6 px-4 py-6 text-center text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            REACTOR · Built on Arc · Not audited · Test / local only
          </footer>
        </Providers>
      </body>
    </html>
  );
}
