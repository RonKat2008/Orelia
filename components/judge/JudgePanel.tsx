import { AlertTriangle, Info } from "lucide-react";
import type { CareNeeds } from "@/lib/contracts/care-needs";
import type { Judgement, JudgeResult, JudgeVerdict } from "@/lib/contracts/judge";
import { Badge, Details } from "@/components/ui";
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

/** Verdict is dynamic state, so it is the row's one badge; drop stays neutral (never red: it is not an error). */
const TONE: Record<JudgeVerdict, "ok" | "gold" | "neutral"> = { keep: "ok", maybe: "gold", drop: "neutral" };

type Heading = "h2" | "h3" | "h4";
const SUB: Record<Heading, "h3" | "h4" | "h5"> = { h2: "h3", h3: "h4", h4: "h5" };

/** Scope flags as plain lines with an icon and words (not a badge each: v2 badge budget is 2 per row). */
function Flags({ flags }: { flags: Judgement["flags"] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Scope flags" className="m-0 grid list-none gap-1 p-0">
      {flags.map((flag) => {
        const Icon = flag.hard ? AlertTriangle : Info;
        return (
          <li
            key={`${flag.code}-${flag.text}`}
            className={`flex min-w-0 items-start gap-1.5 text-small ${flag.hard ? "text-warn-ink" : "text-ink-2"}`}
          >
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">
              {flag.hard ? <span className="font-semibold">Hard flag: </span> : null}
              {flag.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Evidence({ links }: { links: Judgement["links"] }) {
  if (links.length === 0) return <p className="m-0 text-small text-ink-2">No evidence links.</p>;
  return (
    <p className="m-0 flex flex-wrap items-center gap-1.5 text-small text-ink-2">
      Evidence
      {links.map((link, index) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          title={link.claim}
          className="focus-ring inline-flex size-6 items-center justify-center rounded-pill border border-line-strong bg-card text-small font-semibold text-teal no-underline hover:border-teal/50"
        >
          {index + 1}
          <span className="sr-only">: {link.claim} (opens in a new tab)</span>
        </a>
      ))}
    </p>
  );
}

function WhyNot({ item, labels }: { item: Judgement; labels: Map<string, string> }) {
  const missed = resolveNeeds(item.needsMissed, labels);
  return (
    <Details summary="Why not?" label={null}>
      <p className="m-0 break-words text-small text-ink">{item.reason}</p>
      <Flags flags={item.flags} />
      {missed.length > 0 ? (
        <div className="grid gap-1 text-small">
          <p className="m-0 font-semibold text-ink">Needs it missed</p>
          <ul className="m-0 list-disc pl-5 text-ink-2">
            {missed.map((label) => (
              <li key={label} className="break-words">
                {label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.overrides.length > 0 ? (
        <div className="grid gap-1 text-small">
          <p className="m-0 font-semibold text-ink">Adjusted by rules</p>
          <ul className="m-0 list-disc pl-5 text-ink-2">
            {item.overrides.map((note) => (
              <li key={note} className="break-words">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Details>
  );
}

function Row({ item, labels }: { item: Judgement; labels: Map<string, string> }) {
  return (
    <li className="grid min-w-0 gap-2 border-b border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="m-0 min-w-0 break-words text-body font-semibold text-ink">{item.name}</p>
        <span className="flex shrink-0 flex-wrap gap-2">
          <Badge tone={TONE[item.verdict]}>{verdictLabel(item.verdict)}</Badge>
          {item.promoted ? <Badge tone="outline">Kept by score</Badge> : null}
        </span>
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-small text-ink-2">
        <span>{KIND_LABEL[item.kind]}</span>
        <span>Tier: {item.tier}</span>
        <span>{formatScore(item.score)}</span>
        <span>{formatRank(item.rank)}</span>
        <span>{confidenceLabel(item.confidence)}</span>
      </p>
      <p className="m-0 max-w-prose break-words text-small text-ink">{item.verdict === "drop" ? item.plain : item.reason}</p>
      {item.verdict !== "drop" ? <Flags flags={item.flags} /> : null}
      <Evidence links={item.links} />
      {item.verdict === "drop" ? <WhyNot item={item} labels={labels} /> : null}
    </li>
  );
}

/** The final judge's verdicts (keep / maybe / dropped, each dropped one with "Why not?"). Judge view only. */
export function JudgePanel({
  judge,
  needs,
  headingAs: HeadingTag = "h3",
}: {
  judge: JudgeResult;
  needs: CareNeeds | null;
  /** Level of the panel heading; sections use the next level. */
  headingAs?: Heading;
}) {
  const labels = needLabels(needs);
  const sections = groupVerdicts(judge);
  const SectionTag = SUB[HeadingTag];
  return (
    <section aria-labelledby="judge-heading" className="grid min-w-0 gap-4">
      <header className="grid gap-1">
        <HeadingTag id="judge-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft text-balance">
          Final judge
        </HeadingTag>
        <p className="m-0 text-small text-ink-2">
          Kept {judge.counts.keep} &middot; Maybe {judge.counts.maybe} &middot; Dropped {judge.counts.drop}
        </p>
        {judge.summary ? <p className="m-0 max-w-prose break-words text-body text-ink">{judge.summary}</p> : null}
        {judge.source === "fallback" ? (
          <p className="m-0 text-small text-ink-2">The judge was unavailable; showing the scored order.</p>
        ) : null}
      </header>
      {sections.map((section) => (
        <section key={section.verdict} aria-labelledby={`judge-${section.verdict}`} className="grid gap-1">
          <SectionTag id={`judge-${section.verdict}`} className="m-0 text-small font-semibold text-ink">
            {section.label} ({section.items.length})
          </SectionTag>
          <ul className="m-0 grid list-none border-t border-line p-0">
            {section.items.map((item) => (
              <Row key={item.candidateId} item={item} labels={labels} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
