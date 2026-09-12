import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function UntrustedText({
  children,
  className,
  clamp,
  field = "text",
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  clamp?: boolean;
  field?: "name" | "ticker" | "description" | "text" | "toast" | "activity";
  as?: "span" | "p" | "div" | "h1";
}) {
  return (
    <Tag
      data-untrusted={field}
      className={cn("untrusted-text", clamp && "untrusted-text-clamp", className)}
    >
      {children}
    </Tag>
  );
}
