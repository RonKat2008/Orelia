import { AgentCardMotion } from "@/components/motion/AgentCardMotion";
import type { AgentCardState } from "./stream";

export function countsFor(card: AgentCardState): Record<string, number> | undefined {
  const records = card.counts?.records;
  const evidence = card.counts?.evidence;
  if (records === undefined && evidence === undefined) return undefined;
  return { records: records ?? 0, sources: evidence ?? 0 };
}

export function AgentCard({ card }: { card: AgentCardState }) {
  return (
    <AgentCardMotion name={card.agent} status={card.status} counts={countsFor(card)} entrance={false}>
      {card.outputSummary ? <p className="meta">{card.outputSummary}</p> : null}
      {card.error ? <p className="error">{card.error}</p> : null}
    </AgentCardMotion>
  );
}
