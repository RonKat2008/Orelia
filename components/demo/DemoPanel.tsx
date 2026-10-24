"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DemoStatus } from "@/app/api/demo/lib/actions";
import "./demo.css";

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
    <div className="demo-panel">
      <header className="masthead">
        <Link className="wordmark" href="/about">
          Wayfinder
        </Link>
        <p className="eyebrow">Demo control</p>
      </header>
      <h1>Rehearse the fictional case</h1>
      <p className="lede">
        These controls stay on this machine. They seed a synthetic case and dry-run inboxes, then
        send scripted coordinator replies only to addresses on the reply allowlist. Nothing here
        contacts a real clinic.
      </p>

      {error ? (
        <p className="demo-note demo-note--warn" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className={`demo-note demo-note--${notice.tone}`}>{notice.text}</p> : null}

      <section className="panel stack" aria-labelledby="seed-heading">
        <h2 id="seed-heading">Demo case</h2>
        <p>
          {status?.seeded
            ? `Seeded${status.caseId ? ` as ${status.caseId}` : ""}. Mode: ${status.mode}.`
            : "Not seeded yet."}
        </p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run("seed", "/api/demo/seed", (body) => ({
              tone: "ok",
              text: `Seeded ${String(body.caseId ?? "the demo case")}. Copy the printed allowlist into OUTBOUND_ALLOWLIST yourself; this panel does not edit env files.`,
            }))
          }
        >
          {busy === "seed" ? "Seeding…" : "Seed the demo case"}
        </button>
        {status?.caseId ? (
          <p>
            <Link href="/">Open intake and load the demo case</Link>
          </p>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="dest-heading">
        <h2 id="dest-heading">Test destinations</h2>
        <p className="demo-quiet">
          Fictional coordinators. A destination is marked allowlisted only when it is on{" "}
          <code>OUTBOUND_ALLOWLIST</code>. Replies go to <code>DEMO_REPLY_ALLOWLIST</code> (or to
          outbound addresses that are not coordinators).
        </p>
        {status && status.destinations.length === 0 ? <p>Seed the demo to list them.</p> : null}
        <ul className="demo-dest">
          {(status?.destinations ?? []).map((row) => (
            <li key={row.key}>
              <span className="demo-dest__name">{row.displayName}</span>
              <span className="demo-dest__meta">
                {row.scenario} · {row.address}
              </span>
              <span className={row.onOutboundAllowlist ? "demo-flag demo-flag--ok" : "demo-flag"}>
                {row.onOutboundAllowlist ? "On outbound allowlist" : "Not on outbound allowlist"}
              </span>
            </li>
          ))}
        </ul>
        <p className="demo-quiet">
          Reply allowlist: {status?.replyAllowlist.length ? status.replyAllowlist.join(", ") : "empty — replies go to nobody"}
        </p>
      </section>

      <section className="panel stack" aria-labelledby="run-heading">
        <h2 id="run-heading">Scripted steps</h2>
        <div className="demo-actions">
          <button
            type="button"
            className="secondary"
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
            {busy === "replies" ? "Sending…" : "Trigger scripted replies"}
          </button>
          <button
            type="button"
            className="secondary"
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
            {busy === "advance" ? "Advancing…" : "Advance to day 3"}
          </button>
        </div>
        {clock ? (
          <p className="demo-quiet">
            Simulated now {clock.simulatedNow}. Scale {clock.scale}. Day-3 follow-up{" "}
            {clock.day3FollowUpOpen ? "open" : "not yet"}. The durable workflow still waits on{" "}
            <code>WAYFINDER_SIM_TIME_SCALE</code>; this clock is the rehearsal marker for that window.
          </p>
        ) : null}
      </section>
    </div>
  );
}
