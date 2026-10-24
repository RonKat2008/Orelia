import type { JudgeResult } from "@/lib/contracts/judge";

/** Enough of a shortlist card to find its verdict (persisted ids can differ from the judge's canonical ids). */
export interface CardRef {
  kind: string;
  name?: string;
  title?: string;
  nctId?: string;
  npi?: string | null;
}

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The judge's verdict for a card: NCT id for trials, NPI for experts, else kind + normalized name. */
export function verdictFor(judge: JudgeResult | null, card: CardRef) {
  if (!judge) return undefined;
  const name = norm(card.kind === "trial" ? card.title : card.name);
  return judge.judgements.find(
    (j) =>
      j.kind === card.kind &&
      ((card.nctId && j.nctId === card.nctId) || (card.npi && j.npi === card.npi) || (name && norm(j.name) === name)),
  );
}

/** One plain sentence for the patient view, only for verdicts the judge did not drop. */
export function plainSentenceFor(judge: JudgeResult | null, card: CardRef): string | undefined {
  const v = verdictFor(judge, card);
  return v && v.verdict !== "drop" && v.source === "model" ? v.plain : undefined;
}
