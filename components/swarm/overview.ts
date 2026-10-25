import type { AgentCardState, PhaseRuns } from "./stream";
import { isSettled, swarmTotals } from "./stream";

export type StageState = "pending" | "running" | "done" | "failed";

export type StageRow = { id: "validate" | "judge"; label: string; state: StageState; detail: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Agents worth showing: never the unavailable ones, and once the run is ready never the ones that never ran. */
export function visibleCards(cards: AgentCardState[], ready: boolean): AgentCardState[] {
  return cards.filter((card) => card.status !== "not_implemented" && !(ready && card.status === "queued"));
}

/** "12 agents searching · 7 done · 143 sources", or "12 agents finished · 143 sources · 31 kept" once they settle. */
export function summaryLine(cards: AgentCardState[], ready = false): string {
  const available = visibleCards(cards, ready);
  const settled = available.filter((card) => isSettled(card.status)).length;
  const { records, evidence } = swarmTotals(available);
  const sources = plural(evidence, "source");
  if (available.length > 0 && settled === available.length) {
    return `${plural(available.length, "agent")} finished · ${sources} · ${records} kept`;
  }
  return `${plural(available.length, "agent")} searching · ${settled} done · ${sources}`;
}

/**
 * Stages 2 and 3, derived only from signals the stream already carries: the verifier, ranker, judge and needs rows
 * (phases) and the case status. Both wait until every search has settled; "ready" completes both.
 */
export function stageRows(cards: AgentCardState[], caseStatus: string | undefined, phases: PhaseRuns): StageRow[] {
  const ready = caseStatus === "ready";
  const stopped = caseStatus === "research_failed";
  const searched = cards.length > 0 && cards.every((card) => isSettled(card.status));
  const finished = (status?: string) => status === "done" || status === "not_implemented";

  const validateDone = ready || finished(phases.verify?.status);
  const validateState: StageState = validateDone
    ? "done"
    : stopped
      ? "failed"
      : searched
        ? "running"
        : "pending";

  const judgeDone = ready || finished(phases.judge?.status);
  const judgeState: StageState = judgeDone
    ? "done"
    : stopped
      ? "failed"
      : validateDone
        ? "running"
        : "pending";

  const needs = phases.needs;
  const needsNote = finished(needs?.status) && needs?.summary ? needs.summary : undefined;

  const validateDetail =
    validateState === "done"
      ? "Every claim has a source link"
      : validateState === "running"
        ? (phases.verify?.summary ?? "Checking every claim has a source")
        : validateState === "failed"
          ? "Stopped before it finished"
          : "Starts when the searches finish";
  const judgeDetail =
    judgeState === "done"
      ? "Shortlist ready"
      : judgeState === "running"
        ? (phases.judge?.summary ?? "Ranking fit and checking each match against your needs")
        : judgeState === "failed"
          ? "Stopped before it finished"
          : (needsNote ?? "Needs analysis runs alongside; the judge starts after validation");

  return [
    { id: "validate", label: "Validate", state: validateState, detail: validateDetail },
    { id: "judge", label: "Needs analyst + Judge", state: judgeState, detail: judgeDetail },
  ];
}
