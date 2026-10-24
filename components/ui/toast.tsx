"use client";

import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast } from "sonner";
import { useResolvedTheme } from "@/components/shell/theme";

/**
 * Toaster: mount once (Providers does). Calm by default: bottom-right on desktop,
 * bottom-center on mobile, 5s, never steals focus. Use for confirmations of things
 * the person did ("Draft saved"), never for agent results that need reading.
 */
export function Toaster() {
  const theme = useResolvedTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      duration={5000}
      gap={10}
      visibleToasts={4}
      closeButton
      icons={{
        success: <CircleCheck aria-hidden className="size-5 text-ok" />,
        error: <CircleAlert aria-hidden className="size-5 text-danger" />,
        warning: <TriangleAlert aria-hidden className="size-5 text-warn" />,
        info: <Info aria-hidden className="size-5 text-teal" />,
        loading: <LoaderCircle aria-hidden className="size-5 animate-spin text-ink-2 motion-reduce:animate-none" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group/toast relative flex w-full items-start gap-3 rounded-md border border-line bg-card p-4 pr-10 text-ink shadow-lg font-sans sm:w-[22rem]",
          title: "text-body font-semibold leading-snug",
          description: "mt-0.5 text-small text-ink-2",
          icon: "mt-0.5 shrink-0",
          actionButton:
            "ml-auto shrink-0 cursor-pointer rounded-sm bg-teal px-3 py-1.5 text-small font-semibold text-on-teal hover:bg-teal-ink focus-ring",
          cancelButton:
            "shrink-0 cursor-pointer rounded-sm px-3 py-1.5 text-small font-semibold text-ink-2 hover:bg-paper-2 focus-ring",
          closeButton:
            "absolute! right-2! top-2! left-auto! grid size-7 cursor-pointer place-items-center rounded-pill border-0! bg-transparent! text-ink-3 hover:bg-paper-2! hover:text-ink focus-ring transform-none!",
          success: "border-ok/30",
          error: "border-danger/35",
          warning: "border-warn/40",
        },
      }}
    />
  );
}

type ToastOptions = ExternalToast;

/** toast("Saved"), toast.success(...), toast.error(...), toast.promise(...) */
export const toast = Object.assign((message: string, options?: ToastOptions) => sonnerToast(message, options), {
  success: (message: string, options?: ToastOptions) => sonnerToast.success(message, options),
  error: (message: string, options?: ToastOptions) => sonnerToast.error(message, options),
  warning: (message: string, options?: ToastOptions) => sonnerToast.warning(message, options),
  info: (message: string, options?: ToastOptions) => sonnerToast.info(message, options),
  loading: (message: string, options?: ToastOptions) => sonnerToast.loading(message, options),
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
});
