import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border border-rx-heat/35 bg-rx-heat/12 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-rx-ember",
        className,
      )}
      {...props}
    />
  );
}
