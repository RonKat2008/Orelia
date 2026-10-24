"use client";

import "./motion.css";
import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Evidence } from "@/lib/contracts";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { revealVariants } from "@/lib/motion/variants";

type Props = {
  evidence: Evidence[];
  /** Start expanded. */
  defaultOpen?: boolean;
};

const SOURCE_NAME: Record<Evidence["sourceKind"], string> = {
  pubmed: "PubMed",
  ctgov: "ClinicalTrials.gov",
  nppes: "NPI Registry",
  nci: "NCI",
  exa: "Web page",
  phone_call: "Phone call",
};

function safeHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function formatFetched(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

/** "Show sources" disclosure. Every claim is listed with the page it came from. */
export function EvidenceReveal({ evidence, defaultOpen = false }: Props) {
  const reduced = useReducedMotionGate();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const variants = revealVariants(reduced);
  const count = evidence.length;
  const noun = count === 1 ? "source" : "sources";

  return (
    <div className="wf-evidence" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="wf-evidence__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="wf-evidence__chevron" aria-hidden="true" />
        {open ? `Hide ${count} ${noun}` : `Show ${count} ${noun}`}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            key="panel"
            id={panelId}
            className="wf-evidence__list"
            variants={variants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {evidence.map((item) => {
              const href = safeHref(item.sourceUrl);
              const fetched = formatFetched(item.fetchedAt);
              return (
                <li key={`${item.sourceUrl}#${item.claimType}#${item.claim}`} className="wf-evidence__item">
                  <p className="wf-evidence__claim">{item.claim}</p>
                  <p className="wf-evidence__source">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {SOURCE_NAME[item.sourceKind]}, {hostOf(item.sourceUrl)}
                        <span className="wf-visually-hidden"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span>{SOURCE_NAME[item.sourceKind]}</span>
                    )}
                    {fetched ? <span className="wf-evidence__fetched">checked {fetched}</span> : null}
                  </p>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
