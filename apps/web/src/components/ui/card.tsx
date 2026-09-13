import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[4px] border border-white/10 bg-[color-mix(in_srgb,var(--rx-steel)_88%,transparent)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]",
        className,
      )}
      {...props}
    />
  );
}
