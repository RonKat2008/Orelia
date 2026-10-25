import { CircleAlert, CircleCheck, Clock, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { DocStatus } from "@/lib/accounts/contract";
import { cn } from "@/lib/ui/cn";
import type { UploadPhase } from "./useUploadQueue";

const SPIN = "animate-spin motion-reduce:animate-none";

/** A status as an icon and a few calm words. Plain text, not a badge: colour never carries the meaning alone. */
function Status({ tone, children, icon }: { tone: "ok" | "busy" | "wait" | "bad"; children: ReactNode; icon: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-small font-semibold [&_svg]:size-4",
        tone === "ok" && "text-ok",
        tone === "busy" && "text-teal-ink dark:text-teal",
        tone === "wait" && "text-ink-2",
        tone === "bad" && "text-danger",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Where a local upload is, in words: waiting, getting ready, uploading, reading the text, or failed. */
export function UploadPhaseChip({ phase, progress }: { phase: UploadPhase; progress: number }) {
  switch (phase) {
    case "uploading":
      return <Status tone="busy" icon={<LoaderCircle aria-hidden className={SPIN} />}>Uploading, {progress}%</Status>;
    case "creating":
      return <Status tone="busy" icon={<LoaderCircle aria-hidden className={SPIN} />}>Getting ready</Status>;
    case "queued":
      return <Status tone="wait" icon={<Clock aria-hidden />}>Waiting for its turn</Status>;
    case "processing":
      return <Status tone="busy" icon={<LoaderCircle aria-hidden className={SPIN} />}>Reading the text</Status>;
    case "failed":
      return <Status tone="bad" icon={<CircleAlert aria-hidden />}>Did not upload</Status>;
    default:
      return <Status tone="wait" icon={<Clock aria-hidden />}>Ready to upload</Status>;
  }
}

/** A saved document's state, in words. */
export function DocStatusChip({ status }: { status: DocStatus }) {
  switch (status) {
    case "embedded":
      return <Status tone="ok" icon={<CircleCheck aria-hidden />}>Ready for your agents</Status>;
    case "failed":
      return <Status tone="bad" icon={<CircleAlert aria-hidden />}>We could not read it</Status>;
    case "uploaded":
    case "extracting":
      return <Status tone="busy" icon={<LoaderCircle aria-hidden className={SPIN} />}>Reading the text</Status>;
    default:
      return <Status tone="wait" icon={<Clock aria-hidden />}>Upload did not finish</Status>;
  }
}
