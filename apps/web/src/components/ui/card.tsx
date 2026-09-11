import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/8 bg-[rgba(18,20,24,0.78)] shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-md",
        className,
      )}
      {...props}
    />
  );
}
