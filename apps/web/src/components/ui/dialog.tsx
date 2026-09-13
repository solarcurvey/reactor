"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  trigger,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  children: ReactNode;
  trigger?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-none" />
        <Dialog.Content
          data-testid="modal"
          className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--rx-radius-card)] border border-rx-steel bg-rx-slag p-4 shadow-xl focus:outline-none"
        >
          <Dialog.Title className="text-lg font-semibold text-white">{title}</Dialog.Title>
          <div className="mt-3">{children}</div>
          <Dialog.Close asChild>
            <button type="button" className="mt-4 text-[12px] text-zinc-400 underline" data-testid="modal-close">
              Close
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
