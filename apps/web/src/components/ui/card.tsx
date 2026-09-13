import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[var(--rx-radius-card)] border border-rx-steel bg-[color-mix(in_srgb,var(--rx-graphite)_78%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}
