"use client";

import Link from "next/link";
import { useState } from "react";
import { DocumentSpace } from "@/components/account/documents/DocumentSpace";
import { JudgeOnly } from "@/components/view-mode/ViewOnly";
import { AgentUsage } from "./AgentUsage";
import { DocumentsPanel } from "./DocumentsPanel";

/**
 * /cases/[id]/documents: the case's own document space first (what agents can read), then the older notes and
 * sources list folded away. The judge view adds which documents each agent used.
 */
export function CaseDocumentsView({ caseId }: { caseId: string }) {
  const [version, setVersion] = useState(0);
  return (
    <div className="ds-root grid max-w-wide min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <header className="grid gap-1">
        <h1 className="m-0 font-display text-h2 font-normal text-ink display-soft">Your documents</h1>
        <p className="m-0 text-small text-ink-2">
          Add anything relevant. Wayfinder&rsquo;s agents can read it for this case.{" "}
          <Link href="/account/documents" className="text-teal underline underline-offset-4">
            Manage the full library
          </Link>
        </p>
      </header>

      <DocumentSpace scope={{ caseId }} compact onChange={() => setVersion((n) => n + 1)} />

      <JudgeOnly>
        <AgentUsage caseId={caseId} refreshKey={version} />
      </JudgeOnly>

      <details className="group rounded-md border border-line">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-body font-semibold text-teal focus-ring">
          Notes and sources
        </summary>
        <div className="px-4 pb-4">
          <DocumentsPanel caseId={caseId} embedded />
        </div>
      </details>
    </div>
  );
}
