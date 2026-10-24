import type { goalSchema } from "@/lib/contracts";

export type Goal = (typeof goalSchema.options)[number];

export const GOAL_LABELS: Record<Goal, string> = {
  second_opinion: "A second opinion",
  treatment: "A treatment center",
  trial: "A clinical trial",
  support: "Advocacy and support",
  aid: "Financial or travel aid",
};

export const GOAL_HINTS: Record<Goal, string> = {
  second_opinion: "Specialists who see your condition often.",
  treatment: "Centers with experience in your diagnosis.",
  trial: "Studies that are recruiting and could be near you.",
  support: "Patient groups, peer networks and navigators.",
  aid: "Programs that help with cost, lodging and travel.",
};
