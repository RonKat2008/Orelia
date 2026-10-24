import { describe, expect, it } from "vitest";
import { rank, type RankingCandidate } from "../../lib/ranking/rank";
import { RANKING_WEIGHTS } from "../../config/ranking";
const candidates: RankingCandidate[] = [
  {id:"b",signals:{subtypeExpertise:{value:0.7,text:"14 papers on this disease since 2021",evidenceIds:["paper-2","paper-1","paper-1"]},access:{value:1,text:"In-state practice address",evidenceIds:["registry-1"]}}},
  {id:"a",signals:{subtypeExpertise:{value:1,text:"20 papers on this disease since 2021",evidenceIds:["paper-3"]}}},
  {id:"unsupported",signals:{contactability:{value:1,text:"Claim without evidence",evidenceIds:[]}}},
];
describe("deterministic ranking", () => {
  it("keeps fixed order and human-readable evidenced breakdown regardless of input order", () => {
    const before = JSON.stringify(candidates);
    const result = rank(candidates);
    expect(result).toEqual(rank([...candidates].reverse()));
    expect(JSON.stringify(candidates)).toBe(before);
    expect(result.map(({id,score,rank,breakdown}) => ({id,score,rank,breakdown}))).toMatchInlineSnapshot(`
      [
        {
          "breakdown": [
            {
              "evidenceIds": [
                "paper-3",
              ],
              "factor": "subtypeExpertise",
              "points": 50,
              "text": "20 papers on this disease since 2021",
            },
            {
              "evidenceIds": [],
              "factor": "institutionalFit",
              "points": 0,
              "text": "No verified evidence available",
            },
            {
              "evidenceIds": [],
              "factor": "access",
              "points": 0,
              "text": "No verified evidence available",
            },
            {
              "evidenceIds": [],
              "factor": "contactability",
              "points": 0,
              "text": "No verified evidence available",
            },
          ],
          "id": "a",
          "rank": 1,
          "score": 50,
        },
        {
          "breakdown": [
            {
              "evidenceIds": [
                "paper-1",
                "paper-2",
              ],
              "factor": "subtypeExpertise",
              "points": 35,
              "text": "14 papers on this disease since 2021",
            },
            {
              "evidenceIds": [],
              "factor": "institutionalFit",
              "points": 0,
              "text": "No verified evidence available",
            },
            {
              "evidenceIds": [
                "registry-1",
              ],
              "factor": "access",
              "points": 15,
              "text": "In-state practice address",
            },
            {
              "evidenceIds": [],
              "factor": "contactability",
              "points": 0,
              "text": "No verified evidence available",
            },
          ],
          "id": "b",
          "rank": 2,
          "score": 50,
        },
        {
          "breakdown": [
            {
              "evidenceIds": [],
              "factor": "subtypeExpertise",
              "points": 0,
              "text": "No verified evidence available",
            },
            {
              "evidenceIds": [],
              "factor": "institutionalFit",
              "points": 0,
              "text": "No verified evidence available",
            },
            {
              "evidenceIds": [],
              "factor": "access",
              "points": 0,
              "text": "No verified evidence available",
            },
            {
              "evidenceIds": [],
              "factor": "contactability",
              "points": 0,
              "text": "No verified evidence available",
            },
          ],
          "id": "unsupported",
          "rank": 3,
          "score": 0,
        },
      ]
    `);
  });
  it("defaults to strictly descending weights and allows explicit tuning", () => {
    expect(RANKING_WEIGHTS.subtypeExpertise).toBeGreaterThan(RANKING_WEIGHTS.institutionalFit);
    expect(RANKING_WEIGHTS.institutionalFit).toBeGreaterThan(RANKING_WEIGHTS.access);
    expect(RANKING_WEIGHTS.access).toBeGreaterThan(RANKING_WEIGHTS.contactability);
    expect(rank(candidates,{...RANKING_WEIGHTS,access:100})[0].id).toBe("b");
  });
  it("rejects invalid scores, duplicate ids and non-finite weights", () => {
    expect(() => rank([{id:"x"},{id:"x"}])).toThrow("unique");
    expect(() => rank([{id:"x",signals:{access:{value:NaN,text:"x",evidenceIds:["e"]}}}])).toThrow("Invalid access");
    expect(() => rank([],{...RANKING_WEIGHTS,access:Infinity})).toThrow("finite");
    expect(rank([])).toEqual([]);
  });
});
