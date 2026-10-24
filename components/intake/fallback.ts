import type { CaseInput } from "@/lib/contracts";
import type { DemoReport } from "./demos";

/** Placeholder the local fallback needs to satisfy the case schema; the form shows it as an empty field. */
export const NEEDS_REVIEW = "Needs review";

/** What to pre-fill when the extraction service is not connected. Known samples match; anything else is blank. */
export function fallbackFor(text: string, demos: readonly DemoReport[]): CaseInput {
  const trimmed = text.trim();
  const matched =
    demos.find((demo) => demo.reportText.trim() === trimmed) ??
    demos.find((demo) => trimmed.includes(demo.input.diseaseName));
  if (matched) return matched.input;
  return { diseaseName: NEEDS_REVIEW, goals: [] };
}

export const MAX_UPLOAD_BYTES = 200_000;
const ACCEPTED = /\.(txt|md|markdown)$/i;

export type UploadCheck = { ok: true } | { ok: false; reason: string };

export function checkUpload(file: { name: string; size: number; type: string }): UploadCheck {
  if (!ACCEPTED.test(file.name) && !file.type.startsWith("text/")) {
    return { ok: false, reason: "That file is not plain text. Upload a .txt or .md file, or paste the text." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "That file is larger than 200 KB. Paste the relevant section instead." };
  }
  if (file.size === 0) return { ok: false, reason: "That file is empty." };
  return { ok: true };
}
