"use client";

import { useState } from "react";
import type { LibraryDocument } from "@/lib/accounts/contract";
import { DocumentSpace } from "@/components/account/documents/DocumentSpace";
import { Callout } from "@/components/account/FormBits";
import { Button } from "@/components/ui";
import { INTAKE_COPY } from "./copy";

const COPY = INTAKE_COPY.documents;
const DRAFT_SCOPE = { draft: true } as const;

/** One optional screen before the case exists: add documents, then skip or fill the answers from them. */
export function DocumentsStep({
  busy,
  error,
  onSkip,
  onFill,
}: {
  busy: boolean;
  error: string | null;
  onSkip: () => void;
  onFill: (readyIds: string[]) => void;
}) {
  const [readyIds, setReadyIds] = useState<string[]>([]);
  const onChange = (docs: LibraryDocument[]) =>
    setReadyIds((prev) => {
      const next = docs.filter((doc) => doc.status === "embedded").map((doc) => doc.id);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  return (
    <div className="grid max-w-patient gap-4">
      <div className="grid gap-2">
        <h1 className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance outline-none">
          {COPY.title}
        </h1>
        <p className="m-0 max-w-prose text-body text-ink-2">{COPY.lede}</p>
      </div>
      <DocumentSpace scope={DRAFT_SCOPE} compact onChange={onChange} />
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <div className="flex flex-wrap items-center gap-3">
        {readyIds.length > 0 ? (
          <Button size="lg" loading={busy} loadingText={COPY.filling} onClick={() => onFill(readyIds)}>
            {COPY.fill}
          </Button>
        ) : null}
        <Button variant={readyIds.length > 0 ? "secondary" : "primary"} size="lg" disabled={busy} onClick={onSkip}>
          {COPY.skip}
        </Button>
      </div>
      {readyIds.length > 0 ? <p className="m-0 text-small text-ink-2">{COPY.fillHint}</p> : null}
    </div>
  );
}
