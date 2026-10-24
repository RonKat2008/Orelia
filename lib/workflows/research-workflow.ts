import { NonRetriableError } from "inngest";
import { runResearch, type OrchestratorDeps, type ResearchStep } from "@/lib/agents/orchestrator";
import { inngest } from "./inngest";

export const RESEARCH_EVENT = "case/research.requested";
export const RESEARCH_TIMEOUT_MS = 180_000;
export const RESEARCH_STARTABLE = ["confirmed", "ready", "research_failed"] as const;

type LoadDeps = () => Promise<OrchestratorDeps>;

/** Lazy wiring: registering the endpoint must not open a DB or load fixtures. */
async function defaultDeps(): Promise<OrchestratorDeps> {
  const [{ getServices }, { getResearchWiring }] = await Promise.all([
    import("@/app/api/cases/_lib/services"),
    import("@/app/api/cases/_lib/research-wiring"),
  ]);
  const services = getServices();
  return { ...await getResearchWiring(), cases: services.cases, store: services.runs, persist: services.persist };
}

/** One persisted deadline spans every phase and retry, rather than resetting on each invocation.
 * Use an application deadline instead of Inngest timeouts.finish: platform timeouts cancel a
 * run without invoking onFailure, leaving a case stuck researching. The failure hook below
 * still runs for deadline errors. External calls cannot be forcibly aborted by Promise.race.
 */
export async function executeResearch(caseId: string, deps: OrchestratorDeps, step: ResearchStep) {
  const deadline = await step.run("deadline", async () => Date.now() + RESEARCH_TIMEOUT_MS);
  const bounded: ResearchStep = {
    run: (id, work) => step.run(id, async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new NonRetriableError("Research exceeded 180s deadline");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new NonRetriableError("Research exceeded 180s deadline")), remaining);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }),
  };
  const summary = await runResearch(caseId, { ...deps, step: bounded, deadline });
  // Keep the function result small; full results already live in persisted steps/the database.
  return { candidates: summary.candidates, verify: summary.verify, runStatuses: summary.runStatuses };
}

export async function failResearch(caseId: string, deps: Pick<OrchestratorDeps, "cases">) {
  await deps.cases.compareAndSetStatus(caseId, ["researching"], "research_failed");
}

export function createResearchWorkflow(load?: LoadDeps) {
  const loadDeps = load ?? defaultDeps;
  // Cleanup must still work if source/agent wiring was the cause of the failure.
  const loadFailureDeps = load ?? (async () => {
    const { getServices } = await import("@/app/api/cases/_lib/services");
    return { cases: getServices().cases };
  });
  return inngest.createFunction(
    {
      id: "research-case",
      triggers: { event: RESEARCH_EVENT },
      retries: 3,
      singleton: { key: "event.data.caseId", mode: "skip" },
      onFailure: async ({ event, step }) => {
        const caseId = event.data.event.data.caseId as string;
        await step.run("mark-research-failed", async () => {
          await failResearch(caseId, await loadFailureDeps());
          return { caseId, status: "research_failed" };
        });
      },
    },
    async ({ event, step }) => executeResearch(event.data.caseId as string, await loadDeps(), step as unknown as ResearchStep),
  );
}
