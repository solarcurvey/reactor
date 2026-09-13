import { cn } from "@/lib/utils";
import { BRAND_COPY } from "@/lib/brand";

/** Canonical Industrial Forge vessel + hexagonal ember + one heat notch. */
export function ReactorMark({
  className,
  spin = false,
  variant = "reactor",
}: {
  className?: string;
  spin?: boolean;
  variant?: "reactor" | "core" | "mono";
}) {
  const heat = variant === "mono" ? "currentColor" : "#ff6b2b";
  const steel = variant === "mono" ? "currentColor" : "#8a8e92";
  return (
    <svg viewBox="0 0 64 64" className={cn("text-rx-heat", className)} aria-hidden>
      <title>{variant === "core" ? "CORE" : "REACTOR"}</title>
      <g className={spin ? "origin-center animate-[spin_22s_linear_infinite]" : undefined}>
        <circle cx="32" cy="32" r="23" fill="none" stroke={steel} strokeWidth="5.2" />
        <path
          d="M51.6 36.2a20.4 20.4 0 0 1-7.6 11.4"
          fill="none"
          stroke={heat}
          strokeWidth="5.2"
          strokeLinecap="butt"
        />
      </g>
      <polygon
        points="32,20.2 41.2,25.6 41.2,38.4 32,43.8 22.8,38.4 22.8,25.6"
        fill={heat}
      />
      {variant === "core" ? (
        <polygon points="32,25.4 36.8,28.2 36.8,35.8 32,38.6 27.2,35.8 27.2,28.2" fill="#12110f" />
      ) : null}
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <ReactorMark className="h-8 w-8 shrink-0" />
      <span className="sr-only">{BRAND_COPY.product}</span>
      <div className="hidden leading-none sm:block">
        <div className="text-[15px] font-semibold tracking-[0.08em] text-rx-paper">{BRAND_COPY.product}</div>
        {!compact && (
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rx-muted">
            {BRAND_COPY.category}
          </div>
        )}
      </div>
    </div>
  );
}
