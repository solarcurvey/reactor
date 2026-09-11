"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./logo";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Discover", wide: true },
  { href: "/launch", label: "Ignite" },
  { href: "/trade", label: "Trade", wide: true },
  { href: "/reactor", label: "Reactor" },
  { href: "/rewards", label: "Rewards", wide: true },
  { href: "/core", label: "CORE" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-white/6 bg-[#0b0d10]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
        <Link href="/" className="shrink-0">
          <Wordmark compact />
        </Link>
        <nav className="flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-x-auto text-[12px] sm:justify-center sm:gap-1 sm:text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "shrink-0 rounded-full px-2 py-1.5 text-zinc-400 hover:text-white sm:px-3",
                l.wide && "hidden sm:inline-flex",
                (l.href === "/" ? path === "/" : path === l.href || path.startsWith(`${l.href}/`)) &&
                  "bg-white/8 text-white",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="shrink-0">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
