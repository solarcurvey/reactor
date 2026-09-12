import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Restricted access — REACTOR",
  description: "REACTOR-operated services may be unavailable for a request, account, or location. Public contracts remain callable onchain.",
  robots: { index: false, follow: true },
};

export default function RestrictedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
