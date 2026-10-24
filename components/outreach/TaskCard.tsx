"use client";

import { useEffect, useState } from "react";
import { CircleCheck, ClipboardCheck, Copy, Download } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  toast,
} from "@/components/ui";
import { approveTask, loadPreparedLetter, preparedLetterText, type PreparedLetter } from "./client";
import { formatDay } from "./format";
import { TASK_KIND_LABELS, type OutreachTask } from "./types";

const PREPARED_KINDS = new Set<string>(["referral", "slides", "records"]);

/** The letter Wayfinder wrote but will not send: copy it or download it, then pass it on yourself. */
function PreparedLetterPanel({ letter }: { letter: PreparedLetter }) {
  const text = preparedLetterText(letter);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Letter copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "letter-to-forward.txt";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section aria-label="Letter for you to pass on" className="grid gap-3 rounded-md border border-line bg-paper p-4">
      <p className="m-0 whitespace-pre-line text-small text-ink-2">{letter.instructions}</p>
      <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-card p-3 font-body text-small text-ink">{text}</pre>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          <Copy aria-hidden /> Copy letter
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          <Download aria-hidden /> Download
        </Button>
      </div>
    </section>
  );
}

export type TaskCardTask = Pick<OutreachTask, "id" | "kind" | "status" | "summary"> & {
  contactName?: string;
  dueAt?: string | null;
};

/**
 * One request a contact made of the patient. Approving goes through a confirm
 * dialog and only counts once the server confirms. It never sends anything itself.
 */
export function TaskCard({
  task,
  status,
  onStatus,
}: {
  task: TaskCardTask;
  status?: TaskCardTask["status"];
  onStatus?: (next: TaskCardTask["status"]) => void;
}) {
  const [localStatus, setLocalStatus] = useState(task.status);
  const current = status ?? localStatus;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<PreparedLetter | null>(null);

  useEffect(() => {
    if (!PREPARED_KINDS.has(task.kind)) return;
    let live = true;
    void loadPreparedLetter(task.id).then((letter) => live && setPrepared(letter));
    return () => {
      live = false;
    };
  }, [task.id, task.kind]);

  async function confirm() {
    setBusy(true);
    setProblems([]);
    const result = await approveTask(task.id);
    setBusy(false);
    if (!result.available || !result.approved) {
      setProblems(result.reasons);
      return;
    }
    setLocalStatus("approved");
    onStatus?.("approved");
    setOpen(false);
    toast.success("Task approved", {
      description: "Nothing is sent yet. Any message it leads to will come to the outbox for your approval.",
    });
  }

  const label = TASK_KIND_LABELS[task.kind];
  return (
    <article
      data-task-status={current}
      aria-label={label}
      className="grid gap-3 rounded-md border border-line bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={current === "open" ? "gold" : "ok"} dot={current === "open"}>
          {current === "open" ? "Needs you" : current === "approved" ? "Approved" : "Done"}
        </Badge>
        <span className="font-semibold text-ink">{label}</span>
      </div>
      <p className="m-0 max-w-prose break-words text-body text-ink-2">{task.summary}</p>
      {task.contactName || task.dueAt ? (
        <p className="m-0 text-small text-ink-3">
          {task.contactName}
          {task.contactName && task.dueAt ? " · " : ""}
          {task.dueAt ? `Due ${formatDay(task.dueAt)}` : null}
        </p>
      ) : null}
      {prepared ? <PreparedLetterPanel letter={prepared} /> : null}
      {current === "open" ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <div>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm">
                <ClipboardCheck aria-hidden /> Review and approve
              </Button>
            </DialogTrigger>
          </div>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve this task?</DialogTitle>
              <DialogDescription>
                {label}: {task.summary}
              </DialogDescription>
            </DialogHeader>
            <p className="m-0 text-body text-ink-2">
              {prepared
                ? "Nothing is sent for this one. Approving marks it handled once you have passed the letter on yourself."
                : "This lets the connection agent move on to the next step. It does not send anything by itself. Any message it prepares comes to your outbox, and you approve that separately."}
            </p>
            {problems.length > 0 ? (
              <ul role="alert" className="m-0 grid gap-1 rounded-md border border-danger/30 bg-danger-soft p-3 text-small text-ink">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={busy}>
                  Not now
                </Button>
              </DialogClose>
              <Button loading={busy} loadingText="Approving" onClick={() => void confirm()}>
                Approve task
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <p role="status" className="m-0 flex items-center gap-2 text-small text-ok">
          <CircleCheck aria-hidden className="size-4" /> The server confirmed this. Nothing is sent until you approve
          the next message.
        </p>
      )}
    </article>
  );
}
