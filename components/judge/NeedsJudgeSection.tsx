"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { loadNeedsJudge, type NeedsJudgeResult } from "./client";
import { JudgePanel } from "./JudgePanel";
import { NeedsProfile } from "./NeedsProfile";

export function NeedsJudgeSection({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<NeedsJudgeResult | null>(null);

  useEffect(() => {
    let active = true;
    void loadNeedsJudge(caseId).then((next) => {
      if (active) setResult(next);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  if (!result) {
    return (
      <div role="status" aria-busy="true" className="grid gap-3">
        <span className="sr-only">Loading what your condition needs</span>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }
  if (!result.ok || (!result.needs && !result.judge)) return null;

  return (
    <div className="grid min-w-0 gap-8">
      {result.needs ? <NeedsProfile needs={result.needs} /> : null}
      {result.judge ? <JudgePanel judge={result.judge} needs={result.needs} /> : null}
    </div>
  );
}
