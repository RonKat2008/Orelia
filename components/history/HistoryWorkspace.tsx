"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Plus, Printer } from "lucide-react";
import { Button, EmptyState, LoadingState, PageHeader, Skeleton, controlClasses, toast } from "@/components/ui";
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
/** Heading level of the page title: the case shell prints no h1 now, so each page owns it. */
const CASE_PAGE_HEADING = "h1" as const;

const HEADER_COPY = {
  eyebrow: "Medical history",
  title: "Your records",
  lede: "Add letters and test results once. We'll use them when we contact people.",
} as const;

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
export function HistoryWorkspace({
  caseId,
  samplesEnabled = false,
  libraryNote,
}: {
  caseId: string;
  samplesEnabled?: boolean;
  /** One quiet line under the header (the account-library import). */
  libraryNote?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reduced = useReducedMotionGate();
  const [timeline, setTimeline] = useState<HistoryTimeline | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const kinds = useMemo(() => parseKinds(searchParams.get("kinds")), [searchParams]);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    // "Use my documents" (account library import) changes the history outside this component.
    const onChanged = (e: Event) => { if ((e as CustomEvent<{ caseId?: string }>).detail?.caseId === caseId) setReloadKey(k => k + 1); };
    window.addEventListener("wayfinder:history-changed", onChanged);
    return () => window.removeEventListener("wayfinder:history-changed", onChanged);
  }, [caseId]);

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
  }, [caseId, reloadKey]);

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
    return (
      <>
        <PageHeader as={CASE_PAGE_HEADING} {...HEADER_COPY} />
        <p role="alert" className="m-0 border-l-2 border-danger pl-4 text-body text-ink">{loadError}</p>
      </>
    );
  }
  if (!timeline) {
    return (
      <>
        <PageHeader as={CASE_PAGE_HEADING} {...HEADER_COPY} />
        <LoadingState label="Loading your records">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </LoadingState>
      </>
    );
  }

  const hasRecords = timeline.documents.length > 0;
  const visible = filterEvents(timeline.events, kinds);
  const titles = new Map(timeline.documents.map((doc) => [doc.id, doc.title]));

  const showAdd = !hasRecords || adding;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <PageHeader
        as={CASE_PAGE_HEADING}
        {...HEADER_COPY}
        action={
          hasRecords ? (
            <Button
              onClick={() => {
                setAdding(true);
                requestAnimationFrame(() => document.getElementById("add-records")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));
              }}
            >
              <Plus aria-hidden /> Add records
            </Button>
          ) : undefined
        }
      />

      {libraryNote ? <div className="-mt-4">{libraryNote}</div> : null}

      {!hasRecords ? (
        <EmptyState
          title="No records yet"
          description="Add your first one below. We put them in order and show where each line came from."
        />
      ) : null}

      {showAdd ? <RecordDropzone onSubmit={onAdd} onUploadPdf={onPdf} primary={!hasRecords} /> : null}
      {samplesEnabled ? <SamplePicker onLoad={onSample} /> : null}

      {hasRecords ? (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <ShareDialog caseId={caseId} />
            <Link
              href={`/cases/${encodeURIComponent(caseId)}/history/summary`}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm text-body font-semibold text-teal underline decoration-teal/35 underline-offset-[0.22em] hover:text-teal-ink focus-ring"
            >
              <Printer aria-hidden className="size-4" /> Printable summary
            </Link>
          </div>
          <ConflictsPanel conflicts={timeline.conflicts} />
          <HistorySearch caseId={caseId} onPick={pick} />
          <section aria-labelledby="timeline-heading" className="grid gap-4">
            <h2 id="timeline-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">Timeline</h2>
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
