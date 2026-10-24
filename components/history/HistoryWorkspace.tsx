"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Printer, ScrollText } from "lucide-react";
import { Button, EmptyState, Skeleton, controlClasses, toast } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import {
  HISTORY_FIXTURE_LABELS, HISTORY_SAMPLE_SLUGS, type SampleSlug,
} from "./samples";
import type { AddRecordBody, EventKind, HistoryTimeline } from "@/lib/history/contract";
import { addRecord, deleteDocument, getTimeline, loadSample, uploadPdf } from "./client";
import { ConflictsPanel } from "./ConflictsPanel";
import { DocumentList } from "./DocumentList";
import { HistorySearch } from "./HistorySearch";
import { HistoryTimelineView, KindFilters, scrollToId } from "./HistoryTimeline";
import { RecordDropzone } from "./RecordDropzone";
import { ShareDialog } from "./ShareDialog";
import { eventAnchorId, filterEvents, kindsToParam, parseKinds, toggleKind } from "./model";

const HIGHLIGHT_MS = 4000;

function SamplePicker({ onLoad }: { onLoad: (slug: SampleSlug) => Promise<"ok" | "missing" | string> }) {
  const [slug, setSlug] = useState<SampleSlug>(HISTORY_SAMPLE_SLUGS[0]);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (hidden) return null;
  async function go() {
    setBusy(true);
    setError(null);
    const outcome = await onLoad(slug);
    setBusy(false);
    if (outcome === "missing") setHidden(true);
    else if (outcome !== "ok") setError(outcome);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="sample-slug" className="text-small font-semibold text-ink">Synthetic sample</label>
      <select id="sample-slug" value={slug} onChange={(e) => setSlug(e.target.value as SampleSlug)} className={cn(controlClasses, "h-11 w-auto")}>
        {HISTORY_SAMPLE_SLUGS.map((s) => (
          <option key={s} value={s}>{HISTORY_FIXTURE_LABELS[s]}</option>
        ))}
      </select>
      <Button variant="secondary" onClick={() => void go()} disabled={busy} aria-busy={busy}>
        <FlaskConical aria-hidden /> {busy ? "Loading..." : "Load sample records"}
      </Button>
      {error ? <span role="alert" className="text-small text-danger">{error}</span> : null}
    </div>
  );
}

/** Client container for the medical-history page: fetches the timeline and composes every panel. */
export function HistoryWorkspace({ caseId, samplesEnabled = false }: { caseId: string; samplesEnabled?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reduced = useReducedMotionGate();
  const [timeline, setTimeline] = useState<HistoryTimeline | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const kinds = useMemo(() => parseKinds(searchParams.get("kinds")), [searchParams]);

  useEffect(() => {
    let cancelled = false;
    void getTimeline(caseId).then((result) => {
      if (cancelled) return;
      if (result.ok) setTimeline(result.data);
      else setLoadError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const setKinds = useCallback(
    (next: EventKind[]) => {
      const params = new URLSearchParams(searchParams.toString());
      const value = kindsToParam(next);
      if (value) params.set("kinds", value);
      else params.delete("kinds");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const pick = useCallback((eventId: string) => {
    setHighlightId(eventId);
    if (timeline) {
      const event = timeline.events.find((e) => e.id === eventId);
      if (event && kinds.length > 0 && !kinds.includes(event.kind)) setKinds([]);
    }
  }, [kinds, setKinds, timeline]);

  useEffect(() => {
    if (!highlightId) return;
    const frame = requestAnimationFrame(() => scrollToId(eventAnchorId(highlightId), reduced));
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [highlightId, reduced]);

  const onAdd = useCallback(async (body: AddRecordBody): Promise<string | null> => {
    const result = await addRecord(caseId, body);
    if (!result.ok) return result.message;
    setTimeline(result.data);
    return null;
  }, [caseId]);

  const onPdf = useCallback(async (file: File): Promise<string | null> => {
    const result = await uploadPdf(caseId, file);
    if (!result.ok) return result.message;
    setTimeline(result.data);
    return null;
  }, [caseId]);

  const onDelete = useCallback(async (docId: string): Promise<string | null> => {
    const result = await deleteDocument(caseId, docId);
    if (!result.ok) return result.message;
    setTimeline(result.data);
    toast.success("Record deleted.");
    return null;
  }, [caseId]);

  const onSample = useCallback(async (slug: SampleSlug) => {
    const result = await loadSample(caseId, slug);
    if (result.ok) {
      setTimeline(result.data);
      toast.success("Synthetic sample records loaded.");
      return "ok" as const;
    }
    return result.status === 404 ? ("missing" as const) : result.message;
  }, [caseId]);

  if (loadError) {
    return <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-4 text-danger">{loadError}</p>;
  }
  if (!timeline) {
    return (
      <div aria-busy="true" aria-label="Loading your medical history" className="grid gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const hasRecords = timeline.documents.length > 0;
  const visible = filterEvents(timeline.events, kinds);
  const titles = new Map(timeline.documents.map((doc) => [doc.id, doc.title]));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      {!hasRecords ? (
        <EmptyState
          icon={<ScrollText />}
          title="Bring your records together"
          description="Add visit notes, genetic reports, imaging and lab results. Wayfinder lays them out on one timeline and flags where two records say different things. It organises what your records say and cites each one; it never interprets them or offers medical advice."
        />
      ) : null}

      <RecordDropzone onSubmit={onAdd} onUploadPdf={onPdf} />
      {samplesEnabled ? <SamplePicker onLoad={onSample} /> : null}

      {hasRecords ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <ShareDialog caseId={caseId} />
            <Button asChild variant="secondary">
              <Link href={`/cases/${encodeURIComponent(caseId)}/history/summary`}>
                <Printer aria-hidden /> Printable summary
              </Link>
            </Button>
          </div>
          <ConflictsPanel conflicts={timeline.conflicts} />
          <HistorySearch caseId={caseId} onPick={pick} />
          <section aria-labelledby="timeline-heading" className="grid gap-4">
            <h3 id="timeline-heading" className="m-0 font-display text-h3 font-light text-ink">Timeline</h3>
            <KindFilters
              events={timeline.events}
              selected={kinds}
              onToggle={(kind) => setKinds(toggleKind(kinds, kind))}
              onClear={() => setKinds([])}
            />
            <p aria-live="polite" className="m-0 text-small text-ink-2">
              Showing {visible.length} of {timeline.events.length} events
            </p>
            <HistoryTimelineView events={visible} conflicts={timeline.conflicts} documentTitles={titles} highlightId={highlightId} />
          </section>
          <DocumentList documents={timeline.documents} onDelete={onDelete} />
        </>
      ) : null}
    </div>
  );
}
