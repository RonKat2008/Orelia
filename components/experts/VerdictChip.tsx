import { CircleDashed, ExternalLink, ShieldCheck, ShieldAlert } from "lucide-react";
import type { ChainVerdict, ExpertTrace } from "@/lib/experts/contract";
import { cn } from "@/lib/ui/cn";
import { SourceLinks } from "./SourceLinks";
import { safeHref, verdictView } from "./view-model";

const TONE_TEXT = { ok: "text-ok", warn: "text-warn-ink", neutral: "text-ink-2" } as const;

/**
 * One finding about a person: a short plain-text verdict (icon and words, not a badge), what we found, and where
 * it came from. Rows show at most one badge; the detail view shows these as text.
 */
export function VerdictChip({
  kind,
  verdict,
  text,
  evidenceIds,
  trace,
  url,
  urlLabel,
}: {
  kind: "sees" | "consult";
  verdict: ChainVerdict;
  text: string;
  evidenceIds: readonly string[];
  trace: Pick<ExpertTrace, "evidence">;
  url?: string | null;
  urlLabel?: string;
}) {
  const view = verdictView(kind, verdict);
  const Icon = verdict === "yes" ? ShieldCheck : verdict === "no" ? ShieldAlert : CircleDashed;
  const href = safeHref(url);
  return (
    <div className="grid min-w-0 gap-2">
      <p className={cn("m-0 flex items-start gap-2 text-body font-semibold", TONE_TEXT[view.tone])}>
        <Icon aria-hidden className="mt-1 size-4 shrink-0" />
        {view.label}
      </p>
      {verdict === "unknown" ? (
        <p className="m-0 text-small text-ink-2 text-pretty">We could not find a source yet. That does not mean the answer is no.</p>
      ) : (
        <p className="m-0 text-small text-ink-2 text-pretty">{text}</p>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-small font-semibold text-teal underline-offset-4 hover:underline focus-ring"
        >
          {urlLabel ?? "Program page"}
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
      <SourceLinks trace={trace} ids={evidenceIds} />
    </div>
  );
}
