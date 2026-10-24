import { describe, expect, it } from "vitest";
import type { Case } from "@/lib/contracts";
import {
  PATIENT_QUESTIONS,
  answersToCaseInput,
  answersToReport,
  applyProfilePrefill,
  canAdvance,
  emptyAnswers,
  mergeExtracted,
  questionError,
  type PatientAnswers,
} from "@/components/intake/patient/answers";
import { INTAKE_COPY, intakeCopyStrings } from "@/components/intake/patient/copy";

const base: PatientAnswers = {
  condition: "vascular Ehlers-Danlos syndrome",
  city: "Austin",
  state: "TX",
  travel: "regional",
  goals: ["second_opinion", "trial"],
  insurer: "Aetna",
};

describe("PATIENT_QUESTIONS", () => {
  it("lists the five questions in order", () => {
    expect(PATIENT_QUESTIONS).toEqual(["condition", "home", "travel", "goals", "insurance"]);
  });
});

describe("answersToReport", () => {
  it("composes a plain-text report with every part", () => {
    const text = answersToReport(base);
    expect(text).toContain("Diagnosis: vascular Ehlers-Danlos syndrome.");
    expect(text).toContain("Home: Austin, TX.");
    expect(text).toContain("Can travel: up to 100 miles.");
    expect(text).toContain("Hoping for: a second opinion, a clinical trial.");
    expect(text).toContain("Insurance: Aetna.");
  });

  it("omits empty parts", () => {
    const text = answersToReport({ ...emptyAnswers(), condition: "Marfan syndrome (adult)" });
    expect(text).toBe("Diagnosis: Marfan syndrome (adult).");
    expect(text).not.toContain("Home");
    expect(text).not.toContain("Insurance");
  });

  it("handles state-only and city-only homes", () => {
    expect(answersToReport({ ...base, city: "" })).toContain("Home: TX.");
    expect(answersToReport({ ...base, state: "" })).toContain("Home: Austin.");
  });

  it("describes anywhere travel", () => {
    expect(answersToReport({ ...base, travel: "anywhere" })).toContain("Can travel: anywhere in the country.");
  });

  it("pads very short reports to the API minimum", () => {
    expect(answersToReport({ ...emptyAnswers(), condition: "EDS" }).length).toBeGreaterThanOrEqual(20);
  });

  it("is at least 20 characters for a realistic condition", () => {
    expect(answersToReport({ ...emptyAnswers(), condition: "Sarcoma of the leg" }).length).toBeGreaterThanOrEqual(20);
  });
});

describe("answersToCaseInput", () => {
  it("maps answers onto case fields", () => {
    expect(answersToCaseInput(base)).toEqual({
      diseaseName: "vascular Ehlers-Danlos syndrome",
      homeCity: "Austin",
      homeState: "TX",
      travelLimitMiles: 100,
      goals: ["second_opinion", "trial"],
      insurer: "Aetna",
    });
  });

  it("omits empty strings and unlimited travel", () => {
    const input = answersToCaseInput({ ...emptyAnswers(), condition: "  X  ", travel: "anywhere" });
    expect(input).toEqual({ diseaseName: "X", goals: [] });
    expect("travelLimitMiles" in input).toBe(false);
    expect("homeCity" in input).toBe(false);
  });

  it("maps every travel choice", () => {
    expect(answersToCaseInput({ ...base, travel: "local" }).travelLimitMiles).toBe(25);
    expect(answersToCaseInput({ ...base, travel: "far" }).travelLimitMiles).toBe(500);
  });
});

describe("mergeExtracted", () => {
  const record: Case = {
    id: "3b1e1f0e-5a3b-4a52-9c3b-0d9a3a2f6b11",
    status: "extracted",
    createdAt: "2026-01-01T00:00:00.000Z",
    diseaseName: "Ehlers-Danlos",
    subtype: "vascular",
    stageSummary: "stable",
    diseaseCodes: { orpha: "286" },
    planId: "PPO-1",
    homeCity: "Dallas",
    homeState: "TX",
    insurer: "Cigna",
    travelLimitMiles: 10,
    goals: ["aid"],
  };

  it("lets the patient's answers win and keeps extraction-only fields", () => {
    const merged = mergeExtracted(record, base);
    expect(merged.diseaseName).toBe("vascular Ehlers-Danlos syndrome");
    expect(merged.homeCity).toBe("Austin");
    expect(merged.insurer).toBe("Aetna");
    expect(merged.travelLimitMiles).toBe(100);
    expect(merged.goals).toEqual(["second_opinion", "trial"]);
    expect(merged.subtype).toBe("vascular");
    expect(merged.stageSummary).toBe("stable");
    expect(merged.diseaseCodes).toEqual({ orpha: "286" });
    expect(merged.planId).toBe("PPO-1");
    expect(merged.id).toBe(record.id);
  });

  it("keeps extracted values where the patient left a field blank", () => {
    const merged = mergeExtracted(record, { ...emptyAnswers(), condition: "EDS" });
    expect(merged.homeCity).toBe("Dallas");
    expect(merged.insurer).toBe("Cigna");
    expect(merged.goals).toEqual(["aid"]);
  });

  it("clears the extracted travel limit for 'anywhere'", () => {
    expect(mergeExtracted(record, { ...base, travel: "anywhere" }).travelLimitMiles).toBeUndefined();
  });

  it("does not mutate the record", () => {
    const copy = structuredClone(record);
    mergeExtracted(record, base);
    expect(record).toEqual(copy);
  });
});

describe("canAdvance", () => {
  it("requires a trimmed condition of at most 200 characters", () => {
    expect(canAdvance("condition", emptyAnswers())).toBe(false);
    expect(canAdvance("condition", { ...emptyAnswers(), condition: "   " })).toBe(false);
    expect(canAdvance("condition", { ...emptyAnswers(), condition: "x" })).toBe(true);
    expect(canAdvance("condition", { ...emptyAnswers(), condition: "x".repeat(200) })).toBe(true);
    expect(canAdvance("condition", { ...emptyAnswers(), condition: "x".repeat(201) })).toBe(false);
  });

  it("needs a city or a state for home", () => {
    expect(canAdvance("home", emptyAnswers())).toBe(false);
    expect(canAdvance("home", { ...emptyAnswers(), city: " " })).toBe(false);
    expect(canAdvance("home", { ...emptyAnswers(), city: "Austin" })).toBe(true);
    expect(canAdvance("home", { ...emptyAnswers(), state: "TX" })).toBe(true);
  });

  it("needs a travel choice and at least one goal", () => {
    expect(canAdvance("travel", emptyAnswers())).toBe(false);
    expect(canAdvance("travel", { ...emptyAnswers(), travel: "local" })).toBe(true);
    expect(canAdvance("goals", emptyAnswers())).toBe(false);
    expect(canAdvance("goals", { ...emptyAnswers(), goals: ["aid"] })).toBe(true);
  });

  it("always allows insurance", () => {
    expect(canAdvance("insurance", emptyAnswers())).toBe(true);
  });
});

describe("applyProfilePrefill", () => {
  it("returns the answers unchanged for a null profile", () => {
    const answers = emptyAnswers();
    expect(applyProfilePrefill(answers, null)).toEqual(answers);
  });

  it("fills only empty answers", () => {
    const filled = applyProfilePrefill(
      { ...emptyAnswers(), condition: "Mine", city: "Austin" },
      { condition: "Theirs", city: "Dallas", state: "TX", insurer: "Aetna", travelLimitMiles: 80 },
    );
    expect(filled.condition).toBe("Mine");
    expect(filled.city).toBe("Austin");
    expect(filled.state).toBe("TX");
    expect(filled.insurer).toBe("Aetna");
    expect(filled.travel).toBe("regional");
  });

  it("does not override an existing travel choice and maps miles to the nearest bucket", () => {
    expect(applyProfilePrefill({ ...emptyAnswers(), travel: "local" }, { travelLimitMiles: 400 }).travel).toBe("local");
    expect(applyProfilePrefill(emptyAnswers(), { travelLimitMiles: 10 }).travel).toBe("local");
    expect(applyProfilePrefill(emptyAnswers(), { travelLimitMiles: 400 }).travel).toBe("far");
    expect(applyProfilePrefill(emptyAnswers(), { travelLimitMiles: 5000 }).travel).toBe("anywhere");
  });

  it("does not mutate its input", () => {
    const answers = emptyAnswers();
    applyProfilePrefill(answers, { condition: "X" });
    expect(answers.condition).toBe("");
  });
});

describe("questionError", () => {
  it("returns a problem-plus-fix message only for unanswered required questions", () => {
    expect(questionError("condition", emptyAnswers())).toMatch(/Tell us your condition/);
    expect(questionError("condition", { ...emptyAnswers(), condition: "x".repeat(201) })).toMatch(/200/);
    expect(questionError("home", emptyAnswers())).toMatch(/city or your state/);
    expect(questionError("travel", emptyAnswers())).toMatch(/Choose how far/);
    expect(questionError("goals", emptyAnswers())).toMatch(/Choose at least one/);
    expect(questionError("insurance", emptyAnswers())).toBeUndefined();
    expect(questionError("condition", base)).toBeUndefined();
  });
});

describe("INTAKE_COPY", () => {
  const banned = /\b(agent|swarm|curator|verifier|allowlist|resource|score|rank|tier|pipeline)\b/i;

  it("has no banned words and no sentence over 20 words", () => {
    for (const text of intakeCopyStrings()) {
      expect(text).not.toMatch(banned);
      for (const sentence of text.split(/[.!?]\s+/)) {
        expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
      }
    }
  });

  it("gives every hint at most one sentence", () => {
    for (const q of Object.values(INTAKE_COPY.questions)) {
      expect(q.hint.split(/[.!?]\s+/).filter(Boolean)).toHaveLength(1);
    }
  });
});
