"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { LibraryDocument } from "@/lib/accounts/contract";
import { usedLabel } from "@/lib/accounts/used-label";
import { apiRequest } from "@/components/account/helpers/api";
import { Button } from "@/components/ui";
import { PATIENT_HOME_COPY } from "./copy";

interface Snapshot {
  total: number;
  ready: number;
  used: number;
}

/** One dense row on the patient home: how many documents, how many are ready, and a link to add more. */
export function DocumentsCard({ caseId }: { caseId: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const copy = PATIENT_HOME_COPY.documents;

  useEffect(() => {
    let active = true;
    const id = encodeURIComponent(caseId);
    void Promise.all([
      apiRequest<{ documents: LibraryDocument[] }>(`/api/account/documents?case=${id}`),
      apiRequest<{ uses: { documents: { id: string }[] }[] }>(`/api/cases/${id}/space/usage`),
    ]).then(([docs, usage]) => {
      if (!active) return;
      const list = docs.ok && docs.data ? docs.data.documents : [];
      const usedIds = new Set((usage.ok && usage.data ? usage.data.uses : []).flatMap((u) => u.documents.map((d) => d.id)));
      setSnap({ total: list.length, ready: list.filter((d) => d.status === "embedded").length, used: usedIds.size });
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  const href = `/cases/${caseId}/documents`;
  return (
    <section
      aria-labelledby="documents-card-heading"
      data-testid="documents-card"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-card px-4 py-3"
    >
      <FileText aria-hidden className="size-5 shrink-0 text-ink-2" />
      <div className="min-w-0 flex-1 basis-48">
        <h2 id="documents-card-heading" className="m-0 text-body font-semibold text-ink">{copy.title}</h2>
        <p className="m-0 text-small text-ink-2" aria-live="polite">
          {snap === null ? " " : snap.total === 0 ? copy.empty : copy.count(snap.total, snap.ready)}
          {snap && snap.used > 0 ? ` · ${usedLabel(snap.used)}` : ""}
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link href={href}>{copy.action}</Link>
      </Button>
    </section>
  );
}
