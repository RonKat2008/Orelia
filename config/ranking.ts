export const RANKING_WEIGHTS = Object.freeze({subtypeExpertise: 50, institutionalFit: 25, access: 15, contactability: 10});
export type RankingFactor = keyof typeof RANKING_WEIGHTS;
export type RankingWeights = Record<RankingFactor, number>;
