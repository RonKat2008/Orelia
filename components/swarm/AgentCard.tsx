import type { AgentCardState } from "./stream";
import { AGENT_LABELS } from "./stream";

const STATUS_LABEL: Record<AgentCardState["status"], string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  not_implemented: "Not in this version",
};

export function AgentCard({ card }: { card: AgentCardState }) {
  const records = card.counts?.records;
  const evidence = card.counts?.evidence;
  return (
    <article className="panel" aria-labelledby={`agent-${card.agent}`}>
      <div className="card-head">
        <h3 id={`agent-${card.agent}`}>{AGENT_LABELS[card.agent]}</h3>
        <span className={`status ${card.status}`}>{STATUS_LABEL[card.status]}</span>
      </div>
      <p className="meta">
        {records === undefined && evidence === undefined
          ? "Waiting for counts."
          : `${records ?? 0} records · ${evidence ?? 0} sources`}
      </p>
      {card.outputSummary ? <p className="meta">{card.outputSummary}</p> : null}
      {card.error ? <p className="error">{card.error}</p> : null}
    </article>
  );
}
