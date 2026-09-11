import { cn } from "@/lib/utils";

export function ReactorMark({ className, spin = false }: { className?: string; spin?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("text-cyan-200", className)} aria-hidden>
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8fbff" />
          <stop offset="45%" stopColor="#7ee8ff" />
          <stop offset="100%" stopColor="#16303a" />
        </radialGradient>
      </defs>
      <g className={spin ? "origin-center animate-[spin_18s_linear_infinite]" : undefined}>
        <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.2" />
        <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" />
        <circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" strokeOpacity="0.75" strokeWidth="1.6" />
        <path
          d="M8 30 C16 18, 22 44, 32 32 C42 20, 48 46, 56 34"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.1"
        />
      </g>
      <circle cx="32" cy="32" r="7.5" fill="url(#coreGlow)" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <ReactorMark className="h-8 w-8" />
      <div className="hidden leading-none sm:block">
        <div className="text-[15px] font-semibold tracking-[0.22em] text-white">REACTOR</div>
        {!compact && (
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-400">Built on Arc</div>
        )}
      </div>
    </div>
  );
}
