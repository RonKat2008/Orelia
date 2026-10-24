import { bandShortlist, selectionKey, type ShortlistCard } from "@/components/shortlist/data";
import { expertCenterLabel } from "@/components/shortlist/view-model";
import { RARE_TAG_LABELS, rareTags } from "@/lib/rare-disease/tags";
import { contactRoutesOf } from "@/lib/outreach/reachability";
import { resourceKindLabel } from "@/lib/patient-status/plain";
import { SHORTLIST_COPY } from "./copy";

/** Pure helpers for the patient shortlist (docs/DESIGN-v2.md 7.6). */

export const PICK_LIMIT = 5;
/** Rows shown before "Show N more" when there are no suggestions. */
export const FALLBACK_FIRST = 3;
const WHY_SENTENCES = 2;

/** Usable cards (never excluded ones), the suggested ones first, otherwise in the order we found them. */
export function orderCards(items: readonly ShortlistCard[], suggested: readonly string[]): ShortlistCard[] {
  const bands = bandShortlist([...items]);
  const usable = bands.curated ? [...bands.best, ...bands.listed] : bands.listed;
  return [...usable].sort((a, b) => {
    const sa = suggested.includes(selectionKey(a)) ? 0 : 1;
    const sb = suggested.includes(selectionKey(b)) ? 0 : 1;
    return sa - sb || b.score - a.score;
  });
}

/** How many of the listed cards we suggest (for "We suggest these 3."). */
export function suggestedCount(cards: readonly ShortlistCard[], suggested: readonly string[]): number {
  return cards.filter((card) => suggested.includes(selectionKey(card))).length;
}

/** The suggested rows up front (or the first 3), the rest behind "Show N more". */
export function splitSuggested(
  cards: readonly ShortlistCard[],
  suggested: readonly string[],
): { first: ShortlistCard[]; more: ShortlistCard[] } {
  const picked = cards.filter((card) => suggested.includes(selectionKey(card)));
  const first = picked.length > 0 ? picked : cards.slice(0, FALLBACK_FIRST);
  const firstKeys = new Set(first.map(selectionKey));
  return { first, more: cards.filter((card) => !firstKeys.has(selectionKey(card))) };
}

export function nameOf(card: ShortlistCard): string {
  return card.resource.kind === "trial" ? card.resource.title : card.resource.name;
}

function placeOf(card: ShortlistCard): string | null {
  const r = card.resource as { city?: string; state?: string };
  const place = [r.city, r.state].filter(Boolean).join(", ");
  return place || null;
}

/** "Email", "Phone" or "Online form": the best public route we found, or null. */
export function reachOf(card: ShortlistCard): string | null {
  const channels = new Set(contactRoutesOf(card.evidence).map((route) => route.channel));
  if (channels.has("email")) return SHORTLIST_COPY.reach.email;
  if (channels.has("voice")) return SHORTLIST_COPY.reach.voice;
  if (channels.has("web_form")) return SHORTLIST_COPY.reach.web_form;
  return null;
}

/** Plain type word. Studies and registries get their own words; everything else keeps the shared label. */
function kindWord(card: ShortlistCard): string {
  const tags = rareTags(card.evidence);
  const r = card.resource as { studyType?: string; organizationKind?: string };
  if (card.resource.kind === "trial" && (r.studyType === "observational" || tags.includes("observational_study")))
    return RARE_TAG_LABELS.observational_study;
  if (r.organizationKind === "registry" || tags.includes("registry")) return RARE_TAG_LABELS.registry;
  return resourceKindLabel(card.resource.kind, r.organizationKind);
}

/**
 * One meta line: type · place · how we'd reach them. An expert center adds its name here, not as a badge, because the
 * patient row's only badge is "Good match".
 */
export function metaLine(card: ShortlistCard): string {
  return [kindWord(card), placeOf(card), reachOf(card), expertCenterLabel(card.evidence)].filter(Boolean).join(" · ");
}

/** "Good match" for the strongest picks: suggested or top-rated. At most this one badge per row. */
export function isGoodMatch(card: ShortlistCard, suggested: readonly string[]): boolean {
  return card.tier === "best" || suggested.includes(selectionKey(card));
}

/** Distinct public sources we checked this one against. */
export function sourceCount(card: ShortlistCard): number {
  return new Set(card.evidence.map((item) => item.sourceUrl)).size;
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Two plain sentences: the final check's plain line first, then the reasons we listed. */
export function whyThisOne(card: ShortlistCard, plain?: string | null): string {
  const candidates = [plain, ...(card.tierReasons ?? []).map((r) => r.text), ...card.breakdown.map((b) => b.text)];
  const out: string[] = [];
  for (const text of candidates) {
    if (!text) continue;
    for (const sentence of sentences(text)) {
      if (out.length < WHY_SENTENCES && !out.includes(sentence)) out.push(sentence);
    }
  }
  return out.join(" ");
}

/** Toggle one pick, never past the limit. Returns a new array. */
export function togglePick(current: readonly string[], key: string, limit: number = PICK_LIMIT): string[] {
  if (current.includes(key)) return current.filter((id) => id !== key);
  return current.length >= limit ? [...current] : [...current, key];
}
