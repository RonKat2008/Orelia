import type { CareNeeds } from "@/lib/contracts/care-needs";
import type { Judgement, JudgeResult, JudgeVerdict } from "@/lib/contracts/judge";
import { Badge } from "@/components/ui";
import {
  KIND_LABEL,
  confidenceLabel,
  formatRank,
  formatScore,
  groupVerdicts,
  needLabels,
  resolveNeeds,
  verdictLabel,
} from "./view-model";

const TONE: Record<JudgeVerdict, "ok" | "gold" | "neutral"> = { keep: "ok", maybe: "gold", drop: "neutral" };

function Flags({ flags }: { flags: Judgement["flags"] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Scope flags" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {flags.map((flag) => (
        <li key={`${flag.code}-${flag.text}`}>
          <Badge tone={flag.hard ? "warn" : "outline"} className="h-auto min-h-6 whitespace-normal py-1 text-left">
            {flag.text}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function Evidence({ links }: { links: Judgement["links"] }) {
  if (links.length === 0) return <p className="m-0 text-micro text-ink-3">No evidence links.</p>;
  return (
    <p className="m-0 flex flex-wrap items-center gap-1.5 text-micro text-ink-3">
      Evidence
      {links.map((link, index) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          title={link.claim}
          aria-label={`Evidence ${index + 1}: ${link.claim} (opens in a new tab)`}
          className="focus-ring inline-flex size-6 items-center justify-center rounded-pill border border-line-strong bg-card font-semibold text-teal no-underline hover:border-teal/50"
        >
          {index + 1}
        </a>
      ))}
    </p>
  );
}

function WhyNot({ item, labels }: { item: Judgement; labels: Map<string, string> }) {
  const missed = resolveNeeds(item.needsMissed, labels);
  return (
    <details className="rounded-md border border-line bg-paper-2 px-3 py-2">
      <summary className="focus-ring cursor-pointer text-small font-semibold text-teal">Why not?</summary>
      <div className="mt-2 grid gap-2 text-small text-ink-2">
        <p className="m-0 break-words">{item.reason}</p>
        <Flags flags={item.flags} />
        {missed.length > 0 ? (
          <div>
            <p className="m-0 font-semibold text-ink">Needs it missed</p>
            <ul className="m-0 list-disc pl-5">
              {missed.map((label) => (
                <li key={label} className="break-words">
                  {label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {item.overrides.length > 0 ? (
          <div>
            <p className="m-0 font-semibold text-ink">Adjusted by rules</p>
            <ul className="m-0 list-disc pl-5">
              {item.overrides.map((note) => (
                <li key={note} className="break-words">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function Row({ item, labels }: { item: Judgement; labels: Map<string, string> }) {
  return (
    <li className="grid min-w-0 gap-2 rounded-md border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 min-w-0 break-words text-body font-semibold text-ink">{item.name}</h4>
        <Badge tone="outline">{KIND_LABEL[item.kind]}</Badge>
        <Badge tone={TONE[item.verdict]}>{verdictLabel(item.verdict)}</Badge>
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-3">
        <span>Tier: {item.tier}</span>
        <span>{formatScore(item.score)}</span>
        <span>{formatRank(item.rank)}</span>
        <span>{confidenceLabel(item.confidence)}</span>
      </p>
      <p className="m-0 break-words text-small text-ink">{item.verdict === "drop" ? item.plain : item.reason}</p>
      {item.verdict !== "drop" ? <Flags flags={item.flags} /> : null}
      <Evidence links={item.links} />
      {item.verdict === "drop" ? <WhyNot item={item} labels={labels} /> : null}
    </li>
  );
}

export function JudgePanel({ judge, needs }: { judge: JudgeResult; needs: CareNeeds | null }) {
  const labels = needLabels(needs);
  const sections = groupVerdicts(judge);
  return (
    <section aria-labelledby="judge-heading" className="grid min-w-0 gap-5 rounded-lg border border-line bg-paper-2 p-5 sm:p-6">
      <header className="grid gap-1">
        <h2 id="judge-heading" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
          Judge
        </h2>
        <p className="m-0 text-small text-ink-2">
          Kept {judge.counts.keep} &middot; Maybe {judge.counts.maybe} &middot; Dropped {judge.counts.drop}
        </p>
        {judge.summary ? <p className="m-0 max-w-prose break-words text-body text-ink">{judge.summary}</p> : null}
        {judge.source === "fallback" ? (
          <p className="m-0 text-small text-ink-2">The judge was unavailable; showing the scored order.</p>
        ) : null}
      </header>
      {sections.map((section) => (
        <section key={section.verdict} aria-labelledby={`judge-${section.verdict}`} className="grid gap-2">
          <h3 id={`judge-${section.verdict}`} className="m-0 text-micro font-semibold uppercase text-teal">
            {section.label} ({section.items.length})
          </h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {section.items.map((item) => (
              <Row key={item.candidateId} item={item} labels={labels} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
