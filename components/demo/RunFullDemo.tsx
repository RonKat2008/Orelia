"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "Run full demo": seeds the synthetic case (fictional resources), builds the plan and opens the live console. Sends nothing. */
export function RunFullDemo() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/live/start", { method: "POST", credentials: "same-origin" });
      const body = (await res.json().catch(() => ({}))) as { caseId?: string };
      if (!res.ok || !body.caseId) {
        setError(res.status === 404 ? "Demo mode is off on this deployment." : "The demo could not start. Try again.");
        return;
      }
      router.push(`/cases/${body.caseId}/live?view=judge`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={start} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <PlayCircle className="size-4" aria-hidden />}
        Run full demo
      </Button>
      <p className="text-xs text-ink-2">Synthetic vEDS patient, four fictional resources: email, call, online form, email then call. Nothing is sent until you approve.</p>
      {error ? <p role="alert" className="text-xs text-terracotta">{error}</p> : null}
    </div>
  );
}
