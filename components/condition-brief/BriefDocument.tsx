import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { BriefSource, BriefStatement, ConditionBrief } from "@/lib/condition-brief/contract";
import { EvidenceMarker } from "./Evidence";
import { FadeList, type FadeEntry } from "./Fade";
import { SourceChips } from "./SourceChips";
import {
  ceilingFor,
  EMPTY_FILTERED,
  EMPTY_SECTION,
  filterStatements,
  indexSources,
  matchesLevel,
  QUESTIONS_FRAMING,
  safeHref,
  type LevelFilter,
  type SourceIndex,
} from "./model";

export interface BriefDocumentProps {
  brief: ConditionBrief;
  level: LevelFilter;
  onOpenSource: (source: BriefSource) => void;
}

const LIST = "m-0 grid list-none gap-0 p-0";
const ROW = "grid gap-2.5 border-t border-line py-5 first:border-t-0 first:pt-0";

/** The brief, section by section. Pure and presentational: all state lives in the parent. */
export function BriefDocument({ brief, level, onOpenSource }: BriefDocumentProps) {
  const index = indexSources(brief.sources);
  const ctx = { index, onOpenSource, level };
  return (
    <div className="grid gap-section">
      <Rarity brief={brief} {...ctx} />
      <Known brief={brief} {...ctx} />
      <Studies brief={brief} {...ctx} />
      <Research brief={brief} {...ctx} />
      <Registries brief={brief} {...ctx} />
      <Questions brief={brief} />
    </div>
  );
}

interface Ctx {
  index: SourceIndex;
  onOpenSource: (source: BriefSource) => void;
  level: LevelFilter;
}

function Section({ id, number, title, intro, children }: { id: string; number: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-12">
      <header className="grid content-start gap-2 lg:sticky lg:top-24 lg:self-start">
        <p className="m-0 text-micro text-ink-3" aria-hidden>
          {number}
        </p>
        <h2 id={id} className="display-soft m-0 text-balance font-display text-h3 text-ink">
          {title}
        </h2>
        {intro ? <p className="m-0 text-small text-ink-2">{intro}</p> : null}
      </header>
      <div className="grid min-w-0 content-start gap-2">{children}</div>
    </section>
  );
}

function Empty({ filtered }: { filtered: boolean }) {
  return <p className="m-0 text-body text-ink-2">{filtered ? EMPTY_FILTERED : EMPTY_SECTION}</p>;
}

function Meta({ level, sourceIds, ctx }: { level: BriefStatement["evidenceLevel"]; sourceIds: readonly string[]; ctx: Ctx }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <EvidenceMarker level={level} />
      <SourceChips sourceIds={sourceIds} index={ctx.index} onOpen={ctx.onOpenSource} />
    </div>
  );
}

function statementEntries(statements: readonly BriefStatement[], ctx: Ctx): FadeEntry[] {
  return statements.map((s) => ({
    key: s.id,
    node: (
      <div className={ROW}>
        <p className="m-0 max-w-prose text-pretty text-body text-ink">{s.text}</p>
        <Meta level={s.evidenceLevel} sourceIds={s.sourceIds} ctx={ctx} />
      </div>
    ),
  }));
}

function List({ entries, anyAtAll }: { entries: FadeEntry[]; anyAtAll: boolean }) {
  if (entries.length === 0) return <Empty filtered={anyAtAll} />;
  return <FadeList entries={entries} className={LIST} />;
}

/* ------------------------------- sections ------------------------------- */

function Rarity({ brief, ...ctx }: { brief: ConditionBrief } & Ctx) {
  const figures = brief.prevalence.filter((p) => matchesLevel(ceilingFor([p.sourceId], ctx.index), ctx.level));
  const statements = filterStatements(brief.statements, ["rarity"], ctx.level);
  const total = brief.prevalence.length + brief.statements.filter((s) => s.section === "rarity").length;
  const entries: FadeEntry[] = [
    ...figures.map((p) => ({
      key: `prev:${p.sourceId}:${p.label}:${p.geography ?? ""}`,
      node: (
        <div className={ROW}>
          <p className="display-soft m-0 font-display text-h2 leading-tight text-ink">{p.label}</p>
          <p className="m-0 text-small text-ink-2">
            {[p.prevalenceType, p.geography].filter(Boolean).join(" · ") || "Figure as the source states it"}
          </p>
          <Meta level={ceilingFor([p.sourceId], ctx.index)} sourceIds={[p.sourceId]} ctx={ctx} />
        </div>
      ),
    })),
    ...statementEntries(statements, ctx),
  ];
  return (
    <Section id="brief-rarity" number="01" title="How rare" intro="How many people are affected, as the sources report it.">
      <List entries={entries} anyAtAll={total > 0} />
    </Section>
  );
}

const KNOWN_GROUPS: { section: BriefStatement["section"]; title: string }[] = [
  { section: "mechanism", title: "Mechanism" },
  { section: "genetics", title: "Genetics" },
  { section: "natural_history", title: "Natural history" },
];

function Known({ brief, ...ctx }: { brief: ConditionBrief } & Ctx) {
  const sections = KNOWN_GROUPS.map((g) => g.section);
  const total = brief.statements.filter((s) => sections.includes(s.section)).length;
  const groups = KNOWN_GROUPS.map((g) => ({ ...g, items: filterStatements(brief.statements, [g.section], ctx.level) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <Section id="brief-known" number="02" title="What is known" intro="What the sources say about how the condition works and how it tends to unfold.">
      {groups.length === 0 ? (
        <Empty filtered={total > 0} />
      ) : (
        groups.map((g) => (
          <div key={g.section} className="grid gap-1 pb-4">
            <h3 className="m-0 text-micro text-ink-3">{g.title}</h3>
            <FadeList entries={statementEntries(g.items, ctx)} className={LIST} />
          </div>
        ))
      )}
    </Section>
  );
}

function Studies({ brief, ...ctx }: { brief: ConditionBrief } & Ctx) {
  const studies = brief.studies.filter((s) => matchesLevel(s.evidenceLevel, ctx.level));
  const statements = filterStatements(brief.statements, ["studies"], ctx.level);
  const total = brief.studies.length + brief.statements.filter((s) => s.section === "studies").length;
  const entries: FadeEntry[] = [
    ...statementEntries(statements, ctx),
    ...studies.map((s) => ({
      key: `study:${s.sourceId}`,
      node: (
        <div className={ROW}>
          <h3 className="m-0 max-w-prose text-pretty text-h4 text-ink">{s.title}</h3>
          <p className="m-0 text-small text-ink-2">
            <span className="font-semibold">{s.kind === "review" ? "Review" : "Recent study"}</span>
            {[s.journal, s.year].filter(Boolean).length > 0 ? ` · ${[s.journal, s.year].filter(Boolean).join(", ")}` : ""}
            {s.publicationTypes.length > 0 ? ` · ${s.publicationTypes.join(", ")}` : ""}
          </p>
          <Meta level={s.evidenceLevel} sourceIds={[s.sourceId]} ctx={ctx} />
        </div>
      ),
    })),
  ];
  return (
    <Section id="brief-studies" number="03" title="Key published studies" intro="Review articles and recent papers, with how each was published.">
      <List entries={entries} anyAtAll={total > 0} />
    </Section>
  );
}

function Research({ brief, ...ctx }: { brief: ConditionBrief } & Ctx) {
  const items = brief.research.filter((r) => matchesLevel(r.evidenceLevel, ctx.level));
  const statements = filterStatements(brief.statements, ["research"], ctx.level);
  const total = brief.research.length + brief.statements.filter((s) => s.section === "research").length;
  const entries: FadeEntry[] = [
    ...statementEntries(statements, ctx),
    ...items.map((r) => ({
      key: `research:${r.sourceId}`,
      node: (
        <div className={ROW}>
          <h3 className="m-0 max-w-prose text-pretty text-h4 text-ink">{r.title}</h3>
          <p className="m-0 text-small text-ink-2">
            <span className="font-semibold">{r.kind === "trial" ? "Clinical trial" : "NIH grant"}</span>
            <span className="font-mono text-mono"> · {r.id}</span>
            {r.status ? ` · ${r.kind === "trial" ? "Status" : "Fiscal year"}: ${r.status.replace(/_/g, " ").toLowerCase()}` : ""}
            {r.phase ? ` · ${r.phase.replace(/_/g, " ")}` : ""}
            {r.sponsor ? ` · ${r.sponsor}` : ""}
          </p>
          <Meta level={r.evidenceLevel} sourceIds={[r.sourceId]} ctx={ctx} />
        </div>
      ),
    })),
  ];
  return (
    <Section id="brief-research" number="04" title="Ongoing research" intro="Trials and funded projects. These show what is being studied, not what has been found.">
      <List entries={entries} anyAtAll={total > 0} />
    </Section>
  );
}

function Registries({ brief, ...ctx }: { brief: ConditionBrief } & Ctx) {
  const items = brief.registries.filter((r) => matchesLevel(ceilingFor([r.sourceId], ctx.index), ctx.level));
  const statements = filterStatements(brief.statements, ["registries"], ctx.level);
  const total = brief.registries.length + brief.statements.filter((s) => s.section === "registries").length;
  const entries: FadeEntry[] = [
    ...statementEntries(statements, ctx),
    ...items.map((r) => {
      const href = safeHref(r.url);
      return {
        key: `registry:${r.sourceId}:${r.name}`,
        node: (
          <div className={ROW}>
            <h3 className="m-0 text-h4 text-ink">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm text-teal underline-offset-4 hover:underline focus-ring"
                >
                  {r.name}
                  <ExternalLink aria-hidden className="size-4" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                r.name
              )}
            </h3>
            {r.description ? <p className="m-0 max-w-prose text-body text-ink-2">{r.description}</p> : null}
            <Meta level={ceilingFor([r.sourceId], ctx.index)} sourceIds={[r.sourceId]} ctx={ctx} />
          </div>
        ),
      };
    }),
  ];
  return (
    <Section id="brief-registries" number="05" title="Patient registries" intro="Programmes that collect information from people with the condition.">
      <List entries={entries} anyAtAll={total > 0} />
    </Section>
  );
}

function Questions({ brief }: { brief: ConditionBrief }) {
  return (
    <section aria-labelledby="brief-questions" className="grid gap-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-12">
      <header className="grid content-start gap-2 lg:sticky lg:top-24 lg:self-start">
        <p className="m-0 text-micro text-ink-3" aria-hidden>
          06
        </p>
        <h2 id="brief-questions" className="display-soft m-0 text-balance font-display text-h3 text-ink">
          Questions to ask your doctor
        </h2>
        <p className="m-0 text-small text-ink-2">{QUESTIONS_FRAMING}</p>
      </header>
      <div className="min-w-0 rounded-lg border border-line bg-paper-2 p-6 md:p-8">
        {brief.questions.length === 0 ? (
          <Empty filtered={false} />
        ) : (
          <ol className="m-0 grid list-none gap-5 p-0">
            {brief.questions.map((q, i) => (
              <li key={q.id} className="grid grid-cols-[2rem_1fr] items-baseline gap-3">
                <span aria-hidden className="display-soft font-display text-h4 text-teal">
                  {i + 1}
                </span>
                <p className="m-0 max-w-prose text-pretty font-display text-lead text-ink">{q.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
