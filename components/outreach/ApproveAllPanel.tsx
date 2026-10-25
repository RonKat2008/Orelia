"use client";

import { useState } from "react";
import { CircleCheck, Mail, PhoneCall, TriangleAlert } from "lucide-react";
import { Button, Checkbox } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

export type BatchItem = {
  id: string;
  recipient: string;
  channel: "email" | "voice";
  /** Subject, or the first line of the body. */
  summary: string;
};

export type BatchResult = { ok: true } | { ok: false; reasons: string[] };

type Outcome = BatchResult | "sending";

/**
 * Client-side batching of the existing human approval: each ticked draft is sent through `approveOne`
 * (the same per-item approve request as the single button), one at a time. A refusal never stops the rest.
 */
export function ApproveAllPanel({
  items,
  approveOne,
  onClose,
}: {
  items: readonly BatchItem[];
  approveOne: (id: string) => Promise<BatchResult>;
  onClose: () => void;
}) {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, Outcome>>>(
    {},
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const checked = items.filter((item) => !unticked.has(item.id));
  const succeeded = Object.values(outcomes).filter(
    (o) => o !== "sending" && o.ok,
  ).length;
  const refused = Object.values(outcomes).filter(
    (o) => o !== "sending" && !o.ok,
  ).length;

  function toggle(id: string, on: boolean) {
    setUnticked((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function sendAll() {
    setRunning(true);
    for (const item of checked) {
      setOutcomes((current) => ({ ...current, [item.id]: "sending" }));
      let result: BatchResult;
      try {
        result = await approveOne(item.id);
      } catch {
        result = {
          ok: false,
          reasons: ["The request failed. Nothing was marked approved."],
        };
      }
      setOutcomes((current) => ({ ...current, [item.id]: result }));
    }
    setRunning(false);
    setFinished(true);
  }

  return (
    <section
      aria-label="Approve all drafts"
      className="grid gap-3 rounded-lg border border-line bg-card p-4"
    >
      <p className="m-0 text-body text-ink-2">
        {finished
          ? `${succeeded} approved, ${refused} refused. Refused drafts were not sent.`
          : "Untick any draft you want to leave out. Each one still goes through the safety check on its own."}
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {items.map((item) => {
          const outcome = outcomes[item.id];
          const Icon = item.channel === "email" ? Mail : PhoneCall;
          const labelId = `batch-${item.id}`;
          return (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-md border border-line px-3 py-2"
            >
              <Checkbox
                aria-labelledby={labelId}
                checked={!unticked.has(item.id)}
                disabled={running || finished}
                onCheckedChange={(value) => toggle(item.id, value === true)}
                className="mt-0.5"
              />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span
                  id={labelId}
                  className="flex items-center gap-2 text-body font-semibold text-ink"
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0",
                      item.channel === "email"
                        ? "text-ch-email"
                        : "text-ch-call",
                    )}
                  />
                  <span className="[overflow-wrap:anywhere]">
                    {item.recipient}
                  </span>
                  <span className="text-small font-normal text-ink-2">
                    {item.channel === "email" ? "Email" : "Call"}
                  </span>
                </span>
                <span className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-sm bg-paper-2 p-2 text-small text-ink">
                  {item.summary}
                </span>
                {outcome === "sending" ? (
                  <span role="status" className="text-small text-ink-2">
                    Approving…
                  </span>
                ) : outcome?.ok ? (
                  <span className="inline-flex items-center gap-1 text-small text-ok">
                    <CircleCheck aria-hidden className="size-4" /> Approved
                  </span>
                ) : outcome ? (
                  <span className="grid gap-0.5 text-small text-danger">
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <TriangleAlert aria-hidden className="size-4" /> Refused
                    </span>
                    {outcome.reasons.map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {finished ? (
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button
              loading={running}
              loadingText="Sending"
              disabled={checked.length === 0}
              onClick={() => void sendAll()}
            >
              Send {checked.length} approved
            </Button>
            <Button variant="ghost" disabled={running} onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
