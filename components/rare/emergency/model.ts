import { z } from "zod";
import { emergencyFactSchema, needSourceSchema } from "@/lib/contracts/care-needs";
import { historyEventSchema } from "@/lib/history/contract";
import { EMERGENCY_HEADER, type CardContent } from "@/lib/rare-disease/emergency/contract";

export const EMERGENCY_DISCLAIMER = "This is information you wrote and approved. It is not medical advice. In an emergency call 911.";

export interface SheetLine {
  text: string;
  /** Where a line comes from, in a few words. */
  note?: string;
}
export interface SheetSection {
  heading: string;
  lines: SheetLine[];
}
export interface SheetModel {
  title: string;
  condition: string | null;
  approvedOn: string | null;
  sections: SheetSection[];
  header: string;
  disclaimer: string;
}

const section = (heading: string, lines: SheetLine[]): SheetSection[] => (lines.length > 0 ? [{ heading, lines }] : []);

/** Plain date for the sheet, from an ISO timestamp. Null when it does not parse. */
export function formatApprovedOn(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/** One neutral model that both the on-screen card and the saved file render from. Pure. */
export function buildSheetModel(content: CardContent, condition: string | null, approvedAt: string | null): SheetModel {
  const facts = content.facts.map((f) => ({ text: f.text, note: f.sources.map((s) => s.short).join(", ") }));
  const records = content.records.map((r) => ({
    text: [r.title, ...r.findings].join(". "),
    note: [r.docTitle, r.date].filter(Boolean).join(", "),
  }));
  const contacts = content.contacts.map((c) => ({ text: `${c.name}, ${c.relationship}`, note: c.phone }));
  const team = content.careTeam.map((c) => ({ text: `${c.name}, ${c.role}`, note: c.phone }));
  return {
    title: "Emergency information",
    condition,
    approvedOn: formatApprovedOn(approvedAt),
    sections: [
      ...section("What to tell emergency staff", facts),
      ...section("From my records", records),
      ...section("My contacts", contacts),
      ...section("My care team", team),
    ],
    header: EMERGENCY_HEADER,
    disclaimer: EMERGENCY_DISCLAIMER,
  };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

const FILE_CSS =
  "body{font:16px/1.45 system-ui,sans-serif;color:#000;background:#fff;margin:0;padding:16px;max-width:36rem}" +
  "h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.05rem;margin:14px 0 4px;border-bottom:1px solid #000}" +
  "ul{margin:0;padding-left:1.1rem}li{margin:2px 0}small{display:block}p{margin:8px 0}";

/** A self-contained HTML page (no scripts, no links out) the patient can keep on their phone. */
export function renderSheetHtml(m: SheetModel): string {
  const sections = m.sections
    .map((s) => `<h2>${escapeHtml(s.heading)}</h2><ul>${s.lines
      .map((l) => `<li>${escapeHtml(l.text)}${l.note ? ` <small>${escapeHtml(l.note)}</small>` : ""}</li>`)
      .join("")}</ul>`)
    .join("");
  const body =
    `<h1>${escapeHtml(m.title)}</h1>` +
    (m.condition ? `<p><strong>Condition:</strong> ${escapeHtml(m.condition)}</p>` : "") +
    sections +
    `<p><small>${escapeHtml(m.header)}</small></p><p><small>${escapeHtml(m.disclaimer)}${m.approvedOn ? ` Approved ${escapeHtml(m.approvedOn)}.` : ""}</small></p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title)}</title><style>${FILE_CSS}</style></head><body>${body}</body></html>`;
}

/** Stable JSON with sorted keys, so a hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Hash of what the patient approves: the filtered card plus the condition name shown above it. SHA-256 in the
 * browser (the node hash in lib/rare-disease/emergency/hash.ts is server-only). Any change needs a new approval.
 */
export async function sheetHash(content: CardContent, condition: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ content, condition }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Wire shape of GET /api/cases/[id]/emergency (never trust the wire). */
export const emergencyDataSchema = z.object({
  undiagnosed: z.boolean(),
  condition: z.string().nullable(),
  needs: z.object({ emergencyFacts: z.array(emergencyFactSchema), sources: z.array(needSourceSchema) }).nullable(),
  events: z.array(historyEventSchema),
  documents: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type EmergencyData = z.infer<typeof emergencyDataSchema>;
