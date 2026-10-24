"use client";

import { AnimatePresence, motion } from "motion/react";
import { SourceChip } from "@/components/ui";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { enterVariants } from "@/lib/motion/variants";
import type { SourceRef } from "./stream";

const MAX_CHIPS = 8;

/** The newest sources the swarm has linked, appearing as searches finish. */
export function SourceStrip({ sources, preview }: { sources: SourceRef[]; preview: boolean }) {
  const reduced = useReducedMotionGate();
  const variants = enterVariants(reduced, 8);
  const shown = sources.slice(0, MAX_CHIPS);
  return (
    <section aria-labelledby="sources-heading" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="sources-heading" className="m-0 font-sans text-h4 font-bold text-ink">
          Latest sources
        </h3>
        {preview ? <span className="text-small text-ink-2">Example links, not real findings</span> : null}
      </div>
      {shown.length === 0 ? (
        <p className="m-0 text-small text-ink-2">
          Links appear here as searches finish. A claim without a source link never reaches your shortlist.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          <AnimatePresence initial={false}>
            {shown.map((source) => (
              <motion.li
                key={source.url}
                layout={reduced ? false : "position"}
                variants={variants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="min-w-0 max-w-full"
              >
                <SourceChip url={source.url} title={source.title} verified={source.verified} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
