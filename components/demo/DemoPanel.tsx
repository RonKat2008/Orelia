"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { useCallback, useEffect, useState } from "react";
import type { DemoStatus } from "@/app/api/demo/lib/actions";

type Notice = { tone: "ok" | "warn"; text: string };

async function postJson(path: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

export function DemoPanel() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/demo/status");
    if (!res.ok) {
      setError("This panel is off. Set WAYFINDER_DEMO=1 and restart.");
      return;
    }
    setStatus((await res.json()) as DemoStatus);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/demo/status").then(async (res) => {
      if (!active) return;
      if (!res.ok) {
        setError("This panel is off. Set WAYFINDER_DEMO=1 and restart.");
        return;
      }
      const body = (await res.json()) as DemoStatus;
      if (active) setStatus(body);
    });
    return () => {
      active = false;
    };
  }, []);

  async function run(action: string, path: string, done: (body: Record<string, unknown>) => Notice) {
    setBusy(action);
    setError(null);
    try {
      const res = await postJson(path);
      if (!res.ok) {
        setError(typeof res.body.error === "string" ? res.body.error : "That step did not run.");
        return;
      }
      setNotice(done(res.body));
      await refresh();
    } catch {
      setError("The demo control request did not complete.");
    } finally {
      setBusy(null);
    }
  }

  const clock = status?.clock;

  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <div role="note" className="border-b border-warn/50 bg-warn-soft">
        <p className="page-container m-0 flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-small font-semibold text-warn-ink">
          <FlaskConical aria-hidden className="size-4" />
          Demo only. Not part of the product. Visible only while WAYFINDER_DEMO is on.
        </p>
      </div>
      <main id="main" className="page-container grid gap-8 py-10 sm:py-14">
        <header className="grid gap-3">
          <Link href="/about" className="w-fit rounded-sm text-small font-semibold text-teal no-underline hover:underline focus-ring">
            Back to Wayfinder
          </Link>
          <h1 className="m-0 max-w-none font-display text-h1 font-light display-soft text-balance">
            Demo <em className="emph">console</em>
          </h1>
          <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
            These controls stay on this machine. They seed a synthetic case and dry-run inboxes, then send scripted
            coordinator replies only to addresses on the reply allowlist. Nothing here contacts a real clinic.
          </p>
        </header>

        {error ? (
          <p role="alert" className="m-0 rounded-md border border-danger/40 bg-danger-soft p-4 text-body text-ink">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className={cn(
              "m-0 rounded-md border p-4 text-body text-ink",
              notice.tone === "ok" ? "border-ok/40 bg-ok-soft" : "border-warn/50 bg-warn-soft",
            )}
          >
            {notice.text}
          </p>
        ) : null}

        <div data-theme="dark" className="grain grid gap-0 overflow-hidden rounded-lg border border-line-strong bg-paper text-ink shadow-xl">
          <section aria-labelledby="seed-heading" className="grid gap-4 border-b border-line p-5 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="seed-heading" className="m-0 font-mono text-mono font-semibold uppercase">1 / Demo case</h2>
              <Badge tone={status?.seeded ? "ok" : "warn"} dot>
                {status?.seeded ? "Seeded" : "Not seeded"}
              </Badge>
            </div>
            <p className="m-0 font-mono text-mono text-ink-2 [overflow-wrap:anywhere]">
              {status?.seeded
                ? `case ${status.caseId ?? "unknown"} / mode ${status.mode}`
                : "No demo case yet."}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button
                type="button"
                loading={busy === "seed"}
                loadingText="Seeding"
                disabled={busy !== null}
                onClick={() =>
                  void run("seed", "/api/demo/seed", (body) => ({
                    tone: "ok",
                    text: `Seeded ${String(body.caseId ?? "the demo case")}. Copy the printed allowlist into OUTBOUND_ALLOWLIST yourself; this panel does not edit env files.`,
                  }))
                }
              >
                Seed the demo case
              </Button>
              {status?.caseId ? (
                <Button asChild variant="link">
                  <Link href="/start">Open intake and load the demo case</Link>
                </Button>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="dest-heading" className="grid gap-4 border-b border-line p-5 sm:p-8">
            <h2 id="dest-heading" className="m-0 font-mono text-mono font-semibold uppercase">2 / Test destinations</h2>
            <p className="m-0 max-w-prose text-small text-ink-2">
              Fictional coordinators. A destination is allowlisted only when it is on{" "}
              <code className="font-mono">OUTBOUND_ALLOWLIST</code>. Replies go to{" "}
              <code className="font-mono">DEMO_REPLY_ALLOWLIST</code> (or to outbound addresses that are not
              coordinators).
            </p>
            {status && status.destinations.length === 0 ? (
              <p className="m-0 text-small text-ink-2">Seed the demo to list them.</p>
            ) : null}
            <ul className="m-0 grid list-none gap-0 p-0">
              {(status?.destinations ?? []).map((row) => (
                <li key={row.key} className="grid gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                  <div className="grid gap-0.5">
                    <span className="font-semibold">{row.displayName}</span>
                    <span className="font-mono text-mono text-ink-2 [overflow-wrap:anywhere]">
                      {row.scenario} / {row.address}
                    </span>
                  </div>
                  <Badge tone={row.onOutboundAllowlist ? "ok" : "warn"} dot>
                    {row.onOutboundAllowlist ? "On outbound allowlist" : "Not on outbound allowlist"}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="m-0 font-mono text-mono text-ink-2 [overflow-wrap:anywhere]">
              reply allowlist: {status?.replyAllowlist.length ? status.replyAllowlist.join(", ") : "empty, replies go to nobody"}
            </p>
          </section>

          <section aria-labelledby="run-heading" className="grid gap-4 p-5 sm:p-8">
            <h2 id="run-heading" className="m-0 font-mono text-mono font-semibold uppercase">3 / Scripted steps</h2>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                loading={busy === "replies"}
                loadingText="Sending"
                disabled={busy !== null}
                onClick={() =>
                  void run("replies", "/api/demo/replies", (body) => ({
                    tone: Number(body.replied) > 0 ? "ok" : "warn",
                    text: `Replies sent: ${String(body.replied ?? 0)}. Still waiting: ${String(body.pending ?? 0)}. Refused: ${
                      Array.isArray(body.refused) ? body.refused.length : 0
                    }.`,
                  }))
                }
              >
                Trigger scripted replies
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={busy === "advance"}
                loadingText="Advancing"
                disabled={busy !== null}
                onClick={() =>
                  void run("advance", "/api/demo/advance", (body) => ({
                    tone: body.day3FollowUpOpen ? "ok" : "warn",
                    text: body.day3FollowUpOpen
                      ? `Simulated time is ${String(body.simulatedNow)}. The day-3 follow-up window is open. Approve the draft on the tracker; it is not sent on its own.`
                      : `Simulated time is ${String(body.simulatedNow)}.`,
                  }))
                }
              >
                Advance to day 3
              </Button>
            </div>
            {clock ? (
              <p className="m-0 max-w-prose text-small text-ink-2">
                Simulated now <span className="font-mono">{clock.simulatedNow}</span>. Scale{" "}
                <span className="font-mono">{clock.scale}</span>. Day-3 follow-up{" "}
                {clock.day3FollowUpOpen ? "open" : "not yet"}. The durable workflow still waits on{" "}
                <code className="font-mono">WAYFINDER_SIM_TIME_SCALE</code>; this clock is the rehearsal marker for
                that window.
              </p>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
