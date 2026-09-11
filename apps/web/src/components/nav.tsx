"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./logo";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Explore" },
  { href: "/launch", label: "Ignite" },
  { href: "/rewards", label: "Rewards" },
  { href: "/core", label: "CORE" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-white/6 bg-[#0b0d10]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="shrink-0">
          <Wordmark compact />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-zinc-400 hover:text-white",
                path === l.href && "bg-white/8 text-white",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
