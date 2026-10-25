"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCheck, FastForward, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveAll, pendingApprovals, type ApproveItem } from "@/lib/demo-live/approve-all";

interface Props {
  caseId: string;
}

type Pending = Awaited<ReturnType<typeof pendingApprovals>>;

const sameOrigin = (path: string, init?: RequestInit) => fetch(path, { ...init, credentials: "same-origin" });

/**
 * Demo console controls for one live-demo case. "Approve all" is the patient pressing every approve button through
 * the normal routes (each send still passes checkOutbound); the list below it shows what it approved, item by item.
 * "Deliver replies now" and "Skip ahead 3 business days" run the same per-minute cron tick early.
 */
export function LiveDemoControls({ caseId }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [items, setItems] = useState<ApproveItem[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await pendingApprovals(caseId, sameOrigin));
    } catch {
      setPending(null);
    }
  }, [caseId]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  async function onApproveAll() {
    setBusy("approve");
    setNote(null);
    try {
      const done = await approveAll(caseId, sameOrigin);
      setItems((prev) => [...done, ...prev].slice(0, 12));
      if (done.length === 0) setNote("Nothing is waiting for approval right now.");
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  async function onTick(action: "tick" | "skip_ahead") {
    setBusy(action);
    setNote(null);
    try {
      const res = await sameOrigin(`/api/cases/${caseId}/demo-live`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const body = (await res.json().catch(() => ({}))) as { steps?: Record<string, Record<string, unknown>>; shifted?: { shifted: number } | null };
      if (!res.ok) setNote("That step did not run.");
      else if (action === "skip_ahead") setNote(`Moved ${body.shifted?.shifted ?? 0} waiting contact(s) 5 days ahead; follow-ups drafted for your approval.`);
      else setNote(`Coordinator replies sent: ${Number(body.steps?.demoResponder?.replied ?? 0)}.`);
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  const waiting = pending ? Number(pending.plan) + pending.messages + pending.applications : 0;

  return (
    <section aria-labelledby="demo-controls-h" className="rounded-md border border-[var(--color-line,#e3dccf)] bg-[var(--color-surface,#fffdf8)] p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="demo-controls-h" className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted,#5b6666)]">Demo controls</h2>
        <Button size="sm" onClick={onApproveAll} disabled={busy !== null || waiting === 0} aria-describedby="demo-approve-desc">
          {busy === "approve" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <CheckCheck className="size-4" aria-hidden />}
          Approve all{waiting ? ` (${waiting})` : ""}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onTick("tick")} disabled={busy !== null}>
          <Inbox className="size-4" aria-hidden /> Deliver replies now
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onTick("skip_ahead")} disabled={busy !== null}>
          <FastForward className="size-4" aria-hidden /> Skip ahead 3 business days
        </Button>
      </div>
      <p id="demo-approve-desc" className="mt-1.5 text-xs text-[var(--color-ink-muted,#5b6666)]">
        {pending
          ? `Waiting for you: ${pending.plan ? "the contact plan, " : ""}${pending.messages} message(s) or call(s), ${pending.applications} online application(s). Each one still passes the safety gate.`
          : "Checking what is waiting for approval…"}
      </p>
      {note ? <p role="status" className="mt-1 text-xs">{note}</p> : null}
      {items.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-xs" aria-label="Approved items">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.id}-${i}`} className={it.ok ? "" : "text-[var(--color-terracotta,#a4532f)]"}>
              {it.ok ? "✓" : "✕"} {it.label}: {it.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
