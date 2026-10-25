"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleDot, Copy, Download } from "lucide-react";
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
import { cn } from "@/lib/ui/cn";

const PREPARED_KINDS = new Set<string>(["referral", "slides", "records"]);

/** The letter Orelia wrote but will not send: copy it or download it, then pass it on yourself. */
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
    <section aria-label="Letter for you to pass on" className="grid gap-2">
      <p className="m-0 whitespace-pre-line text-small text-ink-2">{letter.instructions}</p>
      <pre
        tabIndex={0}
        aria-label="Letter text"
        className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 p-4 font-body text-small text-ink focus-ring"
      >
        {text}
      </pre>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="link" size="sm" onClick={() => void copy()}>
          <Copy aria-hidden /> Copy letter
        </Button>
        <Button variant="link" size="sm" onClick={download}>
          <Download aria-hidden /> Download letter
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
 * No box of its own: it sits inside the tracker's detail pane (docs/DESIGN-v2.md 4.4, no nested cards).
 * `emphasis="primary"` makes its review button the view's one primary; every other request uses a link.
 */
export function TaskCard({
  task,
  status,
  onStatus,
  emphasis = "link",
}: {
  task: TaskCardTask;
  status?: TaskCardTask["status"];
  onStatus?: (next: TaskCardTask["status"]) => void;
  emphasis?: "primary" | "link";
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
      className={cn("grid gap-2 border-l-2 pl-4", current === "open" ? "border-l-teal" : "border-l-line")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-ink">{label}</span>
        {current === "open" ? (
          <Badge tone="teal">
            <CircleDot aria-hidden /> Needs you
          </Badge>
        ) : (
          <Badge tone="ok">
            <CircleCheck aria-hidden /> {current === "approved" ? "Approved" : "Done"}
          </Badge>
        )}
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
              {emphasis === "primary" ? (
                <Button>Review this request</Button>
              ) : (
                <Button variant="link">Review this request</Button>
              )}
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
                : "This lets us move on to the next step. It does not send anything by itself. Any message we write for it comes to your outbox, and you approve that separately."}
            </p>
            {problems.length > 0 ? (
              <ul role="alert" className="m-0 grid gap-1 rounded-md border border-danger/30 bg-danger-soft p-4 text-small text-ink">
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
        <p role="status" className="m-0 text-small text-ink-2">
          Confirmed. Nothing is sent until you approve the next message.
        </p>
      )}
    </article>
  );
}
