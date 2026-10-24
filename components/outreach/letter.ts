import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE } from "@/lib/safety/disclosure";
import type { ShareableFieldKey } from "./fields";

export type LetterSegment = { kind: "text" | "disclosure"; text: string };

const DISCLOSURES = [AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE];

/** Split a message into prose and the AI-disclosure sentence so the UI can set the latter apart. */
export function splitDisclosure(body: string): LetterSegment[] {
  const segments: LetterSegment[] = [];
  let rest = body;
  while (rest.length > 0) {
    const hits = DISCLOSURES.map((sentence) => ({ sentence, at: rest.indexOf(sentence) })).filter((hit) => hit.at >= 0);
    if (hits.length === 0) {
      segments.push({ kind: "text", text: rest });
      break;
    }
    const first = hits.reduce((a, b) => (b.at < a.at ? b : a));
    const before = rest.slice(0, first.at);
    if (before.trim().length > 0) segments.push({ kind: "text", text: before });
    segments.push({ kind: "disclosure", text: first.sentence });
    rest = rest.slice(first.at + first.sentence.length);
  }
  return segments.filter((segment) => segment.kind === "disclosure" || segment.text.trim().length > 0);
}

export type PreviewShare = { key: ShareableFieldKey; label: string; value: string };

/**
 * A plain-language sketch of what a contact would read, built only from the ticked fields.
 * It is a preview of intent: the real draft is written by the server after consent is saved.
 */
export function buildLetterPreview(
  channel: "email" | "voice",
  shares: readonly PreviewShare[],
): { opening: string; lines: string[]; closing: string } {
  const value = (key: ShareableFieldKey) => shares.find((share) => share.key === key)?.value;
  const diagnosis = value("diseaseName");
  const subtype = value("subtype");
  const city = value("homeCity");
  const state = value("homeState");
  const place = city && state ? `${city}, ${state}` : (city ?? state);

  const lines: string[] = [];
  const subject = diagnosis ? `an adult with ${subtype ? `${subtype} ` : ""}${diagnosis}` : "an adult patient";
  lines.push(
    channel === "email"
      ? `I am writing on behalf of ${subject}${place ? `, who lives in ${place}` : ""}.`
      : `I am calling on behalf of ${subject}${place ? `, who lives in ${place}` : ""}.`,
  );
  if (!diagnosis && subtype) lines.push(`Subtype: ${subtype}.`);
  const stage = value("stageSummary");
  if (stage) lines.push(`Stage summary: ${stage}.`);
  const insurer = value("insurer");
  const plan = value("planId");
  if (insurer || plan) lines.push(`Insurance: ${[insurer, plan ? `plan ${plan}` : null].filter(Boolean).join(", ")}.`);
  const travel = value("travelLimitMiles");
  if (travel) lines.push(`They could travel up to ${travel} miles.`);
  const goals = value("goals");
  if (goals) lines.push(`What they are hoping for: ${goals}.`);
  lines.push(
    channel === "email"
      ? "Could you tell me what you would need to see them, and the best next step?"
      : "Could you tell me what is needed to be seen, and the best next step?",
  );
  return {
    opening: channel === "email" ? "Hello," : "",
    lines,
    closing: channel === "email" ? "Thank you." : "",
  };
}
