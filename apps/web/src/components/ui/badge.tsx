import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--rx-radius-chip)] border border-rx-steel bg-rx-steel/40 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-rx-paper",
        className,
      )}
      {...props}
    />
  );
}
