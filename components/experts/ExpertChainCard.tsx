import { Fragment, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { ExpertChain, ExpertTrace } from "@/lib/experts/contract";
import { cn } from "@/lib/ui/cn";
import { ChainConnector } from "./ChainConnector";
import { SourceLinks } from "./SourceLinks";
import { VerdictChip } from "./VerdictChip";
import { CHAIN_NODES, channelLabel, connectorDelay, pubmedUrl, safeHref } from "./view-model";

function Node({ title, children, index }: { title: string; children: ReactNode; index: number }) {
  return (
    <li className="grid min-w-0 content-start gap-3 rounded-lg border border-line bg-card p-4 shadow-xs">
      <p className="m-0 flex items-center gap-2 text-micro font-semibold uppercase text-ink-3">
        <span aria-hidden className="grid size-5 place-items-center rounded-pill bg-teal-soft text-teal-ink dark:text-teal">
          {index + 1}
        </span>
        {title}
      </p>
      {children}
    </li>
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

export function ExpertChainCard({ chain, trace, index }: { chain: ExpertChain; trace: ExpertTrace; index: number }) {
  const { paper, author, institution, seesPatients, consultation, howToReach } = chain;
  const paperHref = safeHref(paper.url) ?? pubmedUrl(paper.pmid);
  const nodes = [
    <Node key="paper" title={CHAIN_NODES[0].title} index={0}>
      <h4 className="m-0 font-display text-body font-normal text-ink text-pretty">{paper.title}</h4>
      <p className="m-0 text-small text-ink-2">{paper.year ? `${paper.year} · ` : ""}PMID {paper.pmid}</p>
      <ExtLink href={paperHref}>PubMed record</ExtLink>
      <SourceLinks trace={trace} ids={[paper.evidenceId]} />
    </Node>,
    <Node key="author" title={CHAIN_NODES[1].title} index={1}>
      <h4 className="m-0 font-display text-body font-normal text-ink">{author.name}</h4>
      <p className="m-0 text-small text-ink-2">
        {author.npi ? `NPI ${author.npi}` : "No registry number found yet"}
      </p>
      <SourceLinks trace={trace} ids={author.evidenceIds} />
    </Node>,
    <Node key="institution" title={CHAIN_NODES[2].title} index={2}>
      {institution.name ? (
        <h4 className="m-0 font-display text-body font-normal text-ink text-pretty">{institution.name}</h4>
      ) : (
        <p className="m-0 text-small text-ink-2">Not confirmed yet</p>
      )}
      <ExtLink href={safeHref(institution.pageUrl)}>Institution page</ExtLink>
      <SourceLinks trace={trace} ids={institution.evidenceIds} />
    </Node>,
    <Node key="reach" title={CHAIN_NODES[3].title} index={3}>
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
    </Node>,
  ];

  return (
    <article aria-label={`${author.name}, from PMID ${paper.pmid}`} className="min-w-0">
      <ol
        className={cn(
          "m-0 grid list-none grid-cols-[minmax(0,1fr)] items-stretch gap-2 p-0",
          "xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.25fr)]",
        )}
      >
        {nodes.map((node, i) => (
          <Fragment key={node.key}>
            {node}
            {i < nodes.length - 1 ? (
              <li aria-hidden className="grid list-none place-items-center">
                <ChainConnector delay={connectorDelay(index, i)} />
              </li>
            ) : null}
          </Fragment>
        ))}
      </ol>
    </article>
  );
}
