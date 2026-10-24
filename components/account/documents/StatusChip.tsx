import { CircleAlert, CircleCheck, LoaderCircle, Clock } from "lucide-react";
import type { DocStatus } from "@/lib/accounts/contract";
import { Badge } from "@/components/ui/badge";
import type { UploadPhase } from "./useUploadQueue";

const SPIN = "animate-spin motion-reduce:animate-none";

/** Chip for an in-flight local upload. */
export function UploadPhaseChip({ phase, progress }: { phase: UploadPhase; progress: number }) {
  switch (phase) {
    case "uploading":
      return <Badge tone="teal"><LoaderCircle aria-hidden className={SPIN} />Uploading {progress}%</Badge>;
    case "creating":
    case "queued":
      return <Badge tone="neutral"><Clock aria-hidden />{phase === "queued" ? "Waiting" : "Starting"}</Badge>;
    case "processing":
      return <Badge tone="teal"><LoaderCircle aria-hidden className={SPIN} />Reading text</Badge>;
    case "failed":
      return <Badge tone="danger"><CircleAlert aria-hidden />Failed</Badge>;
    default:
      return <Badge tone="outline">Ready to upload</Badge>;
  }
}

/** Chip for a document as stored on the server. */
export function DocStatusChip({ status }: { status: DocStatus }) {
  switch (status) {
    case "embedded":
      return <Badge tone="ok"><CircleCheck aria-hidden />Embedded</Badge>;
    case "failed":
      return <Badge tone="danger"><CircleAlert aria-hidden />Failed</Badge>;
    case "uploaded":
    case "extracting":
      return <Badge tone="teal"><LoaderCircle aria-hidden className={SPIN} />Reading text</Badge>;
    default:
      return <Badge tone="warn"><Clock aria-hidden />Upload incomplete</Badge>;
  }
}
