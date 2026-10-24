import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { chainPapers, type ExpertChain, type ExpertTrace } from "@/lib/experts/contract";
import { formatCitation } from "@/lib/identity/paper-evidence";
import { SourceLinks } from "./SourceLinks";
import { VerdictChip } from "./VerdictChip";
import { channelLabel, pubmedUrl, safeHref } from "./view-model";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3">
      <h4 className="m-0 font-sans text-body font-semibold text-ink">{title}</h4>
      {children}
    </section>
  );
}

function ExtLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 w-fit max-w-full items-center gap-1.5 break-words rounded-sm text-small font-semibold text-teal underline-offset-4 hover:underline focus-ring"
    >
      {children}
      <ExternalLink aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * The detail view for one chain: who they are, the papers that connect them to your condition, where they work, and
 * how to reach them. Every line keeps its source links. `showName` is false inside a sheet that already titles it.
 */
export function ExpertChainCard({
  chain,
  trace,
  showName = true,
}: {
  chain: ExpertChain;
  trace: ExpertTrace;
  index?: number;
  showName?: boolean;
}) {
  const { author, institution, seesPatients, consultation, howToReach } = chain;
  const papers = chainPapers(chain);

  return (
    <article aria-label={`${author.name}, ${papers.length} ${papers.length === 1 ? "paper" : "papers"}`} className="grid min-w-0 gap-6">
      {showName ? (
        <header className="grid gap-1">
          <h3 className="m-0 font-display text-h3 font-normal text-ink display-soft">{author.name}</h3>
          <p className="m-0 text-small text-ink-2">{author.npi ? `NPI ${author.npi}` : "No registry number found yet"}</p>
          <SourceLinks trace={trace} ids={author.evidenceIds} />
        </header>
      ) : (
        <div className="grid gap-1">
          <p className="m-0 text-small text-ink-2">{author.npi ? `NPI ${author.npi}` : "No registry number found yet"}</p>
          <SourceLinks trace={trace} ids={author.evidenceIds} />
        </div>
      )}

      <Section title={papers.length > 1 ? "Their papers" : "Their paper"}>
        <ul className="m-0 grid list-none gap-4 p-0" aria-label="Papers by this author">
          {papers.map((paper) => (
            <li key={paper.pmid} className="grid gap-1">
              <p className="m-0 text-body text-ink text-pretty">{formatCitation(paper)}</p>
              <p className="m-0 text-small text-ink-2">PMID {paper.pmid}</p>
              <ExtLink href={safeHref(paper.url) ?? pubmedUrl(paper.pmid)}>PubMed record</ExtLink>
              <SourceLinks trace={trace} ids={[paper.evidenceId]} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Where they work">
        {institution.name ? (
          <p className="m-0 text-body text-ink text-pretty">{institution.name}</p>
        ) : (
          <p className="m-0 text-small text-ink-2">Not confirmed yet</p>
        )}
        <ExtLink href={safeHref(institution.pageUrl)}>Institution page</ExtLink>
        <SourceLinks trace={trace} ids={institution.evidenceIds} />
      </Section>

      <Section title="How to reach them">
        <VerdictChip kind="sees" verdict={seesPatients.verdict} text={seesPatients.text} evidenceIds={seesPatients.evidenceIds} trace={trace} />
        <VerdictChip
          kind="consult"
          verdict={consultation.verdict}
          text={consultation.text}
          evidenceIds={consultation.evidenceIds}
          trace={trace}
          url={consultation.url}
          urlLabel="Consultation page"
        />
        {howToReach.length > 0 ? (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Ways to reach">
            {howToReach.map((route) => (
              <li key={`${route.channel}:${route.evidenceId}`} className="grid gap-1">
                <p className="m-0 text-small text-ink">
                  <strong className="font-semibold">{channelLabel(route.channel)}:</strong> {route.label}
                </p>
                <p className="m-0 break-all text-small text-ink-2">{route.address}</p>
                <SourceLinks trace={trace} ids={[route.evidenceId]} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-small text-ink-2">No way to reach them confirmed yet.</p>
        )}
      </Section>
    </article>
  );
}
