import type { JourneyPlanStatus } from "@/components/journey/model";

/** What the tracker says when no resource agents exist yet. Agents only exist once the plan is approved. */
export function agentsEmptyCopy(planStatus: JourneyPlanStatus | null): string {
  return planStatus === "approved"
    ? "Your contact plan is approved. Agents are getting started."
    : "Agents start when you approve the contact plan.";
}
