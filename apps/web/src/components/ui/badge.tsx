import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-cyan-100",
        className,
      )}
      {...props}
    />
  );
}
