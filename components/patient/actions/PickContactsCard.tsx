"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@/components/ui";
import { bandShortlist, initialSelection, loadShortlist, selectionKey, type ShortlistCard } from "@/components/shortlist/data";
import { selectOutreach, writeStoredOutreach } from "@/components/outreach/client";
import { loadCaseContacts, loadShortlistNames, withDisplayNames } from "@/components/outreach/case-activity";
import { resourceKindLabel } from "@/lib/patient-status/plain";
import { cn } from "@/lib/ui/cn";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

const LIMIT = 5;
const FIRST_SHOWN = 8;
const SELECTED_KEY = (caseId: string) => `wayfinder.selected.${caseId}`;

function readStored(caseId: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(SELECTED_KEY(caseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(caseId: string, ids: string[]) {
  try {
    sessionStorage.setItem(SELECTED_KEY(caseId), JSON.stringify(ids));
  } catch {
    // Selection still works for this visit.
  }
}

function nameOf(card: ShortlistCard): string {
  return card.resource.kind === "trial" ? card.resource.title : card.resource.name;
}

function placeOf(card: ShortlistCard): string | null {
  const r = card.resource as { city?: string; state?: string };
  const place = [r.city, r.state].filter(Boolean).join(", ");
  return place || null;
}

function reasonOf(card: ShortlistCard): string | null {
  return card.tierReasons?.[0]?.text ?? card.breakdown[0]?.text ?? null;
}

type Loaded = { cards: ShortlistCard[]; suggested: string[]; error: string | null };

/** Simplified shortlist: plain reasons, an Add button, up to five, the curator's picks pre-selected. */
export function PickContactsCard({ caseId, onDone, detailsHref, headline }: ActionProps & { detailsHref: string; headline: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void loadShortlist(caseId).then((result) => {
      if (!active) return;
      const bands = bandShortlist(result.payload.items);
      const usable = bands.curated ? [...bands.best, ...bands.listed] : bands.listed;
      const suggested = result.payload.suggested;
      const ordered = [...usable].sort((a, b) => {
        const sa = suggested.includes(selectionKey(a)) ? 0 : 1;
        const sb = suggested.includes(selectionKey(b)) ? 0 : 1;
        return sa - sb || b.score - a.score;
      });
      setLoaded({ cards: ordered, suggested, error: result.error });
      setSelected(initialSelection(readStored(caseId), suggested, LIMIT));
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  const shown = useMemo(() => (loaded ? (expanded ? loaded.cards : loaded.cards.slice(0, FIRST_SHOWN)) : []), [loaded, expanded]);

  function toggle(key: string) {
    setSelected((current) => {
      const next = current.includes(key) ? current.filter((id) => id !== key) : current.length >= LIMIT ? current : [...current, key];
      writeStored(caseId, next);
      return next;
    });
  }

  async function contact() {
    if (selected.length === 0) return;
    setBusy(true);
    setErrors([]);
    writeStored(caseId, selected);
    const result = await selectOutreach(caseId, selected);
    if (!result.ok) {
      setBusy(false);
      setErrors(result.reasons);
      toast.error("We couldn't add those people", { description: "Nothing was sent." });
      return;
    }
    const [live, names] = await Promise.all([loadCaseContacts(caseId), loadShortlistNames(caseId)]);
    writeStoredOutreach(caseId, {
      contacts: withDisplayNames(result.value.contacts, live),
      unavailable: result.value.unavailable.map((item) => (names.has(item.candidateId) ? { ...item, name: names.get(item.candidateId) } : item)),
    });
    const skipped = result.value.unavailable.length;
    toast.success(`Added ${result.value.contacts.length} to contact`, {
      description: skipped > 0 ? `${skipped} ${skipped === 1 ? "has" : "have"} no public email or phone, so we'll use their online form if they have one.` : "Nothing is sent until you approve each message.",
    });
    await onDone();
    setBusy(false);
  }

  return (
    <ActionFrame kind="pick_contacts" title="Who should we contact?" lede={headline} detailsHref={detailsHref}>
      {!loaded ? (
        <div aria-busy="true" role="status" className="grid gap-3">
          <span className="sr-only">Loading who we found</span>
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-24 w-full" />
          ))}
        </div>
      ) : loaded.cards.length === 0 ? (
        <ActionError messages={[loaded.error ?? "We couldn't load the list. The detailed view has everything we found."]} />
      ) : (
        <>
          <p className="m-0 text-body font-semibold text-ink" aria-live="polite">
            {selected.length} of {LIMIT} picked
            {loaded.suggested.length > 0 ? <span className="font-normal text-ink-2"> · we picked a few to start</span> : null}
          </p>
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
            {shown.map((card) => {
              const key = selectionKey(card);
              const on = selected.includes(key);
              const full = !on && selected.length >= LIMIT;
              const reason = reasonOf(card);
              const place = placeOf(card);
              const name = nameOf(card);
              return (
                <li
                  key={key}
                  data-picked={on ? "true" : "false"}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)] items-start gap-3 rounded-md border bg-card p-4 transition-[border-color,background-color] duration-150 motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5",
                    on ? "border-teal/60 bg-teal-soft/40" : "border-line",
                  )}
                >
                  <div className="grid min-w-0 gap-1.5">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-small text-ink-2">
                      <span className="font-semibold">{resourceKindLabel(card.resource.kind, (card.resource as { organizationKind?: string }).organizationKind)}</span>
                      {place ? <span>· {place}</span> : null}
                      {loaded.suggested.includes(key) ? <Badge tone="teal">Suggested</Badge> : null}
                    </p>
                    <p className="m-0 text-h4 font-semibold text-ink [overflow-wrap:anywhere]">{name}</p>
                    {reason ? <p className="m-0 text-body text-ink-2 [overflow-wrap:anywhere]">{reason}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant={on ? "secondary" : "ghost"}
                    size="md"
                    aria-pressed={on}
                    aria-label={`${on ? "Remove" : "Add"} ${name}`}
                    disabled={full || busy}
                    onClick={() => toggle(key)}
                    className="justify-self-start sm:justify-self-end"
                  >
                    {on ? <Check aria-hidden /> : <Plus aria-hidden />}
                    {on ? "Added" : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
          {loaded.cards.length > FIRST_SHOWN ? (
            <div>
              <Button type="button" variant="link" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Show fewer" : `Show all ${loaded.cards.length}`}
              </Button>
            </div>
          ) : null}
          <ActionError messages={errors} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" loading={busy} loadingText="Adding" disabled={selected.length === 0} onClick={() => void contact()}>
              {selected.length === 0 ? "Pick at least one" : `Contact ${selected.length === 1 ? "this one" : `these ${selected.length}`}`}
            </Button>
            <p className="m-0 text-small text-ink-2">Nothing is sent yet. Next you choose what they may see.</p>
          </div>
        </>
      )}
    </ActionFrame>
  );
}
