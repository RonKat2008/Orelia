"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Drawer } from "vaul";
import { cn } from "@/lib/ui/cn";
import { closeButtonClasses, overlayClasses, titleClasses } from "./dialog";
import { DESKTOP_QUERY, useMediaQuery } from "./use-media-query";

export interface SheetProps {
  /** Element that opens the sheet (rendered with asChild, so pass a Button). */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Sticky footer, usually the primary action. */
  footer?: ReactNode;
  children?: ReactNode;
  /** Desktop panel side. Mobile is always a bottom drawer. */
  side?: "right" | "left";
  className?: string;
}

/**
 * Sheet: a bottom drawer (vaul, swipe to dismiss) on phones, a side panel dialog
 * on desktop. One API for both, so pages never branch on viewport.
 */
export function Sheet(props: SheetProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  return isDesktop ? <SidePanel {...props} /> : <BottomDrawer {...props} />;
}

function SidePanel({ trigger, open, onOpenChange, title, description, footer, children, side = "right", className }: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClasses} />
        <DialogPrimitive.Content
          data-slot="sheet-content"
          className={cn(
            "fixed inset-y-3 z-50 flex w-[min(30rem,calc(100vw-1.5rem))] flex-col rounded-lg border border-line bg-card text-ink shadow-xl",
            side === "right" ? "right-3" : "left-3",
            "duration-500 ease-out-expo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            side === "right"
              ? "data-[state=open]:slide-in-from-right-8 data-[state=closed]:slide-out-to-right-8"
              : "data-[state=open]:slide-in-from-left-8 data-[state=closed]:slide-out-to-left-8",
            "motion-reduce:animate-none focus:outline-none",
            className,
          )}
        >
          <header className="grid gap-2 border-b border-line px-7 pb-5 pr-16 pt-7">
            <DialogPrimitive.Title className={titleClasses}>{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-body text-ink-2">{description}</DialogPrimitive.Description>
            ) : null}
          </header>
          <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
          {footer ? <footer className="flex flex-wrap justify-end gap-3 border-t border-line px-7 py-5">{footer}</footer> : null}
          <DialogPrimitive.Close data-slot="sheet-close" className={closeButtonClasses}>
            <X aria-hidden className="size-5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function BottomDrawer({ trigger, open, onOpenChange, title, description, footer, children, className }: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Drawer.Trigger asChild>{trigger}</Drawer.Trigger> : null}
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Drawer.Content
          data-slot="sheet-content"
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-lg border border-b-0 border-line bg-card text-ink shadow-xl",
            "focus:outline-none",
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-pill bg-line-strong" />
          <header className="grid gap-1.5 px-5 pb-4 pt-4">
            <Drawer.Title className={titleClasses}>{title}</Drawer.Title>
            {description ? <Drawer.Description className="text-body text-ink-2">{description}</Drawer.Description> : null}
          </header>
          <div className="flex-1 overflow-y-auto px-5 pb-6">{children}</div>
          {footer ? (
            <footer className="flex flex-col-reverse gap-3 border-t border-line px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {footer}
            </footer>
          ) : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** Close the surrounding Sheet from inside it (works for both drawer and panel). */
export function SheetClose({ children }: { children: ReactNode }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  return isDesktop ? (
    <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>
  ) : (
    <Drawer.Close asChild>{children}</Drawer.Close>
  );
}
