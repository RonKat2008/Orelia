"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/states";
import { useActiveView } from "@/components/view-mode/ViewOnly";
import { toast } from "@/components/ui/toast";
import { DocumentCitations } from "@/components/account/DocumentCitations";
import type { BriefSource, ConditionBrief } from "@/lib/condition-brief/contract";
import { BriefDocument } from "./BriefDocument";
import { BriefHeader, CASE_PAGE_HEADING } from "./BriefHeader";
import { buildBrief, getBrief } from "./client";
import { LevelLegend } from "./LevelLegend";
import { levelCounts, type LevelFilter } from "./model";
import { SourceDrawer } from "./SourceDrawer";

type Phase = { kind: "loading" } | { kind: "none" } | { kind: "error"; message: string } | { kind: "ready"; brief: ConditionBrief };

export function ConditionBriefView({ caseId }: { caseId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [open, setOpen] = useState<BriefSource | null>(null);
  const view = useActiveView();
  const judge = view === "judge";

  useEffect(() => {
    let cancelled = false;
    getBrief(caseId).then((r) => {
      if (cancelled) return;
      if (!r.ok) setPhase({ kind: "error", message: r.message });
      else setPhase(r.brief ? { kind: "ready", brief: r.brief } : { kind: "none" });
    });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const run = useCallback(
    async (refresh: boolean) => {
      setBusy(true);
      const r = await buildBrief(caseId, refresh);
      setBusy(false);
      if (r.ok && r.brief) setPhase({ kind: "ready", brief: r.brief });
      else toast.error(r.ok ? "The brief could not be built." : r.message);
    },
    [caseId],
  );

  const counts = useMemo(() => (phase.kind === "ready" ? levelCounts(phase.brief) : undefined), [phase]);

  if (phase.kind === "loading") return <BriefSkeleton />;

  if (phase.kind === "error") {
    return (
      <div className="ds-root grid max-w-prose gap-4" role="alert">
        <h2 className="display-soft m-0 font-display text-h3 font-normal text-ink">We could not load the brief</h2>
        <p className="m-0 text-body text-ink-2">{phase.message}</p>
        <Button variant="secondary" className="w-fit" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  if (phase.kind === "none") {
    return (
      <div className="ds-root grid max-w-reading gap-6">
        <PageHeader
          as={CASE_PAGE_HEADING}
          eyebrow="Condition brief"
          title="A plain summary of your condition"
          lede="We read public sources such as Orphanet, PubMed and NIH, then write it up. Every line shows its source."
          className="mb-0"
        />
        <div>
          <Button size={judge ? "md" : "lg"} onClick={() => run(false)} loading={busy} loadingText="Building the brief">
            Build the brief
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ds-root grid gap-section">
      <BriefHeader brief={phase.brief} busy={busy} onRefresh={() => run(true)} />
      {judge ? <LevelLegend value={level} onChange={setLevel} counts={counts} /> : null}
      <BriefDocument
        brief={phase.brief}
        level={judge ? level : "all"}
        onOpenSource={setOpen}
        view={view}
        expertsHref={`/cases/${encodeURIComponent(caseId)}/experts`}
      />
      <DocumentCitations caseId={caseId} query={[phase.brief.diseaseName, "diagnosis findings"].join(" ")} heading="What your own documents say" />
      <SourceDrawer source={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function BriefSkeleton() {
  return (
    <LoadingState label="Loading the brief" className="ds-root max-w-reading">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-12 w-full max-w-xl" />
      {[0, 1, 2].map((n) => (
        <div key={n} className="grid gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      ))}
    </LoadingState>
  );
}
