/** Model ids per docs/PLAN.md: Opus for orchestrator/extractor/verifier/classifier, Haiku for research swarm. */
export const OPUS = "claude-opus-5-5";
export const HAIKU = "claude-haiku-5-5";

export type ModelId = typeof OPUS | typeof HAIKU;
