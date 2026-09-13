"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./logo";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Discover", wide: true },
  { href: "/search", label: "Search", wide: true },
  { href: "/launch", label: "Ignite" },
  { href: "/trade", label: "Trade", wide: true },
  { href: "/reactor", label: "THE REACTOR" },
  { href: "/rewards", label: "Rewards", wide: true },
  { href: "/core", label: "CORE" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-rx-slag/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
        <Link href="/" className="shrink-0" aria-label="REACTOR home">
          <Wordmark compact />
        </Link>
        <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-x-auto text-[12px] sm:justify-center sm:gap-1 sm:text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path === l.href || path.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-[2px] px-2 py-1.5 text-rx-muted hover:text-rx-paper sm:px-3",
                  l.wide && "hidden sm:inline-flex",
                  active && "bg-white/8 text-rx-paper",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
