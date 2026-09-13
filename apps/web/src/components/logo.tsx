import { cn } from "@/lib/utils";

/** Canonical Industrial Forge mark. Founder-locked Direction C (Refs #55). */
export function ReactorMark({
  className,
  spin = false,
  title = "REACTOR",
}: {
  className?: string;
  spin?: boolean;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 64 64" className={cn("text-rx-ring", className)} role="img" aria-label={title}>
      <title>{title}</title>
      <g className={spin ? "origin-center motion-safe:animate-[spin_28s_linear_infinite]" : undefined}>
        <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="5" />
        <path d="M52 32a20 20 0 0 1-3.2 10.8" fill="none" stroke="var(--rx-core)" strokeWidth="5" />
      </g>
      <polygon points="32,22 40.2,26.8 40.2,37.2 32,42 23.8,37.2 23.8,26.8" fill="var(--rx-core)" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <ReactorMark className="h-8 w-8" />
      <div className="hidden leading-none sm:block">
        <div className="text-[15px] font-semibold tracking-[0.08em] text-rx-paper">REACTOR</div>
        {!compact && (
          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-rx-cool">Token launch on Arc</div>
        )}
      </div>
    </div>
  );
}
