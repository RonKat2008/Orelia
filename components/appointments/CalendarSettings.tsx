"use client";

import { useEffect, useState } from "react";
import { Copy, Link2, ShieldCheck, Unplug } from "lucide-react";
import { Badge, Button, Card, Input, Label, toast } from "@/components/ui";
import { createFeed, disconnectGoogle, loadFeeds, loadGoogleStatus, revokeFeed, type FeedView, type GoogleStatus } from "./client";

const GOOGLE_MESSAGES: Record<string, string> = {
  connected: "Google Calendar is connected. Confirmed appointments will be added with reminders.",
  declined: "Google sign-in was cancelled. Nothing changed.",
  invalid_state: "That sign-in link expired or did not match. Start again.",
  unavailable: "Google Calendar is not set up on this site yet. The subscription link below works with Google too.",
  failed: "Google did not finish connecting. Try again.",
  scope_missing: "Google did not grant calendar access, so nothing was connected.",
  no_session: "Start or open a case first, then connect your calendar.",
};

/** Calendar sync: a private subscription link (works everywhere) and optional Google Calendar OAuth. */
export function CalendarSettings({ googleResult }: { googleResult?: string }) {
  const [feeds, setFeeds] = useState<FeedView[] | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadFeeds(), loadGoogleStatus()]).then(([f, g]) => {
      if (cancelled) return;
      setFeeds(f.ok ? f.data.feeds : []);
      setGoogle(g.ok ? g.data : { available: false, connected: false, freeBusy: false });
    });
    return () => { cancelled = true; };
  }, []);

  const live = (feeds ?? []).filter((f) => !f.revokedAt && f.url);

  async function mint() {
    setBusy("mint");
    const r = await createFeed();
    setBusy(null);
    if (!r.ok) return toast.error(r.reasons.includes("no_session") ? "Open a case first" : "Could not create a link");
    setFeeds((f) => [...(f ?? []), r.data.feed]);
  }
  async function revoke(id: string) {
    setBusy(id);
    const r = await revokeFeed(id);
    setBusy(null);
    if (!r.ok) return toast.error("Could not revoke the link");
    setFeeds((f) => (f ?? []).map((x) => (x.id === id ? { ...x, revokedAt: new Date().toISOString(), url: undefined, webcalUrl: undefined } : x)));
    toast.success("Link revoked", { description: "Calendars subscribed to it stop updating." });
  }
  async function unplug() {
    setBusy("google");
    const r = await disconnectGoogle();
    setBusy(null);
    if (r.ok) setGoogle((g) => (g ? { ...g, connected: false, freeBusy: false } : g));
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.info("Select the link and copy it");
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card variant="raised" padding="lg" className="grid gap-5">
        <div className="grid gap-2">
          <Badge tone="teal"><Link2 aria-hidden /> Works with every calendar</Badge>
          <h2 className="m-0 font-display text-h3 font-normal text-ink display-soft">Subscribe by link</h2>
          <p className="m-0 max-w-prose text-body text-ink-2">
            A private link your calendar app checks for updates: Apple Calendar, Outlook, or Google (Other calendars, then From URL).
            Event titles never include your diagnosis. Anyone with the link can see your appointment times, so keep it private and revoke it if it leaks.
          </p>
        </div>
        {feeds === null ? null : live.length ? (
          <ul className="m-0 grid list-none gap-4 p-0">
            {live.map((f) => (
              <li key={f.id} className="grid gap-2 rounded-md bg-paper-2 p-4 shadow-inset">
                <Label htmlFor={`feed-${f.id}`} className="text-small">Your private link</Label>
                <Input id={`feed-${f.id}`} readOnly value={f.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-mono" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void copy(f.url!)}><Copy aria-hidden /> Copy link</Button>
                  {f.webcalUrl ? <Button size="sm" variant="secondary" asChild><a href={f.webcalUrl}>Open in calendar app</a></Button> : null}
                  <Button size="sm" variant="ghost" loading={busy === f.id} loadingText="Revoking" onClick={() => void revoke(f.id)}>Revoke</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Button className="w-fit" loading={busy === "mint"} loadingText="Creating" onClick={() => void mint()}>Create my private link</Button>
        )}
      </Card>

      <Card padding="lg" className="grid content-start gap-4">
        <h2 className="m-0 font-display text-h3 font-normal text-ink display-soft">Google Calendar</h2>
        {googleResult && GOOGLE_MESSAGES[googleResult] ? <p role="status" className="m-0 rounded-md bg-teal-soft p-3 text-small text-ink">{GOOGLE_MESSAGES[googleResult]}</p> : null}
        {google === null ? null : !google.available ? (
          <>
            <Badge tone="neutral">Not available yet</Badge>
            <p className="m-0 text-body text-ink-2">Direct Google sync is not switched on for this site. Use the private link: Google Calendar can subscribe to it.</p>
            <Button variant="secondary" disabled className="w-fit">Connect Google Calendar</Button>
          </>
        ) : google.connected ? (
          <>
            <Badge tone="ok"><ShieldCheck aria-hidden /> Connected</Badge>
            <p className="m-0 text-body text-ink-2">When you confirm an appointment it is added with reminders a day and two hours before. Wayfinder can only manage the events it creates.</p>
            {!google.freeBusy ? (
              <div className="grid gap-2 rounded-md bg-paper-2 p-4 shadow-inset">
                <p className="m-0 text-small text-ink-2">Optional: let Wayfinder see when you are busy (not event details) so reschedule requests can suggest times you are free.</p>
                <Button size="sm" variant="secondary" asChild className="w-fit"><a href="/api/integrations/google/connect?scope=freebusy">Allow free/busy</a></Button>
              </div>
            ) : <p className="m-0 text-small text-ink-3">Free/busy is on: reschedule requests suggest times you are free.</p>}
            <Button variant="ghost" className="w-fit" loading={busy === "google"} loadingText="Disconnecting" onClick={() => void unplug()}><Unplug aria-hidden /> Disconnect</Button>
          </>
        ) : (
          <>
            <p className="m-0 text-body text-ink-2">Adds confirmed appointments to your Google Calendar. Wayfinder asks only to manage events, nothing else.</p>
            <Button asChild variant="secondary" className="w-fit"><a href="/api/integrations/google/connect">Connect Google Calendar</a></Button>
          </>
        )}
      </Card>
    </div>
  );
}
