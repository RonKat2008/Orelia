"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import type { BriefSource, ConditionBrief } from "@/lib/condition-brief/contract";
import { BriefDocument } from "./BriefDocument";
import { BriefHeader } from "./BriefHeader";
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
        <h2 className="display-soft m-0 font-display text-h2 text-ink">The brief did not load</h2>
        <p className="m-0 text-body text-ink-2">{phase.message}</p>
        <Button variant="secondary" className="w-fit" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  if (phase.kind === "none") {
    return (
      <div className="ds-root grid max-w-prose gap-5">
        <p className="m-0 text-micro font-semibold uppercase text-ink-3">Condition brief</p>
        <h2 className="display-soft m-0 text-balance font-display text-h1 text-ink">
          A plain-language <em className="emph">brief</em> on your condition
        </h2>
        <p className="m-0 text-lead text-ink-2">
          We read public sources such as Orphanet, PubMed, ClinicalTrials.gov and NIH, then write down how rare the condition is, what is
          known, what research is under way, and questions you might bring to your care team. Every statement shows where it came from and
          how strong that evidence is.
        </p>
        <Button className="w-fit" onClick={() => run(false)} loading={busy} loadingText="Building the brief">
          Build the brief
        </Button>
      </div>
    );
  }

  return (
    <div className="ds-root grid gap-section">
      <BriefHeader brief={phase.brief} busy={busy} onRefresh={() => run(true)} />
      <LevelLegend value={level} onChange={setLevel} counts={counts} />
      <BriefDocument brief={phase.brief} level={level} onOpenSource={setOpen} />
      <SourceDrawer source={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="ds-root grid gap-8" role="status" aria-busy="true">
      <span className="sr-only">Loading the condition brief</span>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-16 w-full max-w-xl" />
      <Skeleton className="h-10 w-72" />
      {[0, 1, 2].map((n) => (
        <div key={n} className="grid gap-3 lg:grid-cols-[14rem_1fr] lg:gap-12">
          <Skeleton className="h-7 w-40" />
          <div className="grid gap-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
