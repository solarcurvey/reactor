import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-[4px] border border-white/10 bg-black/30 px-3.5 text-sm text-rx-paper placeholder:text-rx-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rx-heat/55",
        className,
      )}
      {...props}
    />
  );
}
