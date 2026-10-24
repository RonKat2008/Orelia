import * as chrono from 'chrono-node';
import { neutralizeUntrusted } from '../agents/research/untrusted';
import { DEFAULT_DURATION_MINUTES, type AppointmentKind, type CandidateSlot } from './schema';
import { isTelehealthUrl } from './telehealth';
import { wallTimeToUtc, zoneFromText, zonedParts } from './timezone';

export { isTelehealthUrl };

/**
 * Deterministic extraction of a proposed appointment from an untrusted reply or call transcript. No model is
 * involved: chrono-node finds dates, simple patterns find the address, telehealth link and phone. Every value is
 * literally in the message. Nothing here confirms or sends anything; the caller stores a *proposed* appointment
 * the patient must confirm.
 */
export interface ExtractedProposal {
  kind: AppointmentKind;
  candidates: CandidateSlot[];
  timezone: string;
  location?: string;
  telehealthUrl?: string;
  phone?: string;
  /** The reply reads as a confirmation ("is confirmed", "you are scheduled") rather than an offer. */
  readsAsConfirmed: boolean;
  /** Sanitized sentence the first time came from. */
  quote: string;
}

export interface ExtractOptions {
  /** When the reply arrived: relative dates ("Tuesday") resolve forward from here. */
  receivedAt: Date;
  /** Zone used when the text names none (resource state, else patient home state). */
  defaultTimeZone: string;
  maxCandidates?: number;
}

const MAX_BODY = 20_000;
const MAX_AHEAD_MS = 400 * 24 * 60 * 60 * 1000;

const SCHEDULING = /\b(see you|appointment|appt|scheduled|schedule|reschedul\w*|booked|book you|opening|openings|available|availability|slot|consult(ation)?|visit|interview|intake|meet|telehealth|video (visit|call)|zoom|confirm(ed|ing)?|come in|check[- ]in|arrive)\b/i;
const CONFIRMED = /\b(is confirmed|are confirmed|have confirmed|confirmed for|you are (now )?scheduled|you're (now )?scheduled|has been scheduled|is scheduled|booked (you|for))\b/i;

const KIND_RULES: [RegExp, AppointmentKind][] = [
  [/\bscreening (interview|call)\b|\beligibility (interview|screen)\b|\bpre-?screen/i, 'screening_interview'],
  [/\bintake (call|interview|appointment)\b|\bnew patient (call|intake)\b/i, 'intake_call'],
  [/\btelehealth\b|\bvideo (visit|call|appointment)\b|\bvirtual (visit|appointment)\b|\bzoom\b|\bdoxy\.me\b|\bteams\.microsoft/i, 'telehealth'],
  [/\b(mri|ct scan|pet scan|scan|blood draw|lab draw|biopsy|imaging|test(ing)?)\b/i, 'test'],
  [/\bconsult(ation)?\b|\bsecond opinion\b/i, 'consult'],
];

const STREET = '(?:Ave(?:nue)?|St(?:reet)?|R(?:oa)?d|Blvd|Boulevard|Dr(?:ive)?|L(?:a)?n(?:e)?|Way|Pkwy|Parkway|Ct|Court|Pl(?:ace)?|Hwy|Highway|Sq(?:uare)?|Ter(?:race)?|Circle|Cir)';
const ADDRESS = new RegExp(
  `\\b\\d{2,6}\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Z0-9][\\w.'-]*\\s+){0,4}${STREET}\\b\\.?` +
  `(?:,?\\s+(?:Suite|Ste\\.?|Floor|Fl\\.?|Room|Rm\\.?|Building|Bldg\\.?|Desk)\\s*[\\w-]+)?` +
  `(?:,\\s*[A-Z][a-zA-Z.]+(?:\\s[A-Z][a-zA-Z.]+){0,2},\\s*[A-Z]{2}(?:\\s+\\d{5}(?:-\\d{4})?)?)?`,
);
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b(?:\s*(?:x|ext\.?)\s*\d{1,6})?/i;
const HTTPS_URL = /https:\/\/[^\s<>"')\]]+/gi;
function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf('.', index - 1), text.lastIndexOf('\n', index - 1), -1) + 1;
  const endDot = text.indexOf('.', index + length);
  const endNl = text.indexOf('\n', index + length);
  const ends = [endDot, endNl].filter(n => n >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return neutralizeUntrusted(text.slice(start, end)).trim().slice(0, 300);
}

function kindOf(text: string): AppointmentKind {
  for (const [re, kind] of KIND_RULES) if (re.test(text)) return kind;
  return 'appointment';
}

/** A time is usable only when the reply states the hour and a day (date or weekday). */
function isSpecific(c: chrono.ParsedComponents): boolean {
  return c.isCertain('hour') && (c.isCertain('day') || c.isCertain('weekday'));
}

export function extractProposal(body: string, opts: ExtractOptions): ExtractedProposal | null {
  const text = body.normalize('NFKC').slice(0, MAX_BODY);
  if (!SCHEDULING.test(text)) return null;
  const results = chrono.parse(text, { instant: opts.receivedAt }, { forwardDate: true });
  const zone = zoneFromText(text) ?? opts.defaultTimeZone;
  const candidates: (CandidateSlot & { index: number; length: number })[] = [];
  for (const r of results) {
    if (!isSpecific(r.start)) continue;
    const ownZone = zoneFromText(r.text) ?? zone;
    const wall = { year: r.start.get('year')!, month: r.start.get('month')!, day: r.start.get('day')!, hour: r.start.get('hour')!, minute: r.start.get('minute') ?? 0 };
    const start = wallTimeToUtc(wall, ownZone);
    if (start.getTime() <= opts.receivedAt.getTime() || start.getTime() - opts.receivedAt.getTime() > MAX_AHEAD_MS) continue;
    let end = new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60000);
    if (r.end && r.end.isCertain('hour')) {
      const endWall = { year: r.end.get('year')!, month: r.end.get('month')!, day: r.end.get('day')!, hour: r.end.get('hour')!, minute: r.end.get('minute') ?? 0 };
      const parsedEnd = wallTimeToUtc(endWall, ownZone);
      if (parsedEnd > start && parsedEnd.getTime() - start.getTime() <= 12 * 3600000) end = parsedEnd;
    }
    const statedWeekday = r.start.isCertain('weekday') ? r.start.get('weekday') : null;
    const weekdayMismatch = statedWeekday !== null && r.start.isCertain('day') && zonedParts(start, ownZone).weekday !== statedWeekday;
    if (candidates.some(c => c.startsAt === start.toISOString())) continue;
    candidates.push({ startsAt: start.toISOString(), endsAt: end.toISOString(), text: neutralizeUntrusted(r.text).slice(0, 200), weekdayMismatch, index: r.index, length: r.text.length });
    if (candidates.length >= (opts.maxCandidates ?? 3)) break;
  }
  if (!candidates.length) return null;
  const first = candidates[0];
  const location = text.match(ADDRESS)?.[0]?.trim();
  const telehealthUrl = [...text.matchAll(HTTPS_URL)].map(m => m[0].replace(/[.,;]+$/, '')).find(isTelehealthUrl);
  const phone = text.match(PHONE)?.[0]?.trim();
  return {
    kind: kindOf(text),
    candidates: candidates.map(c => ({ startsAt: c.startsAt, endsAt: c.endsAt, text: c.text, weekdayMismatch: c.weekdayMismatch })),
    timezone: zone,
    ...(location ? { location: neutralizeUntrusted(location).slice(0, 300) } : {}),
    ...(telehealthUrl ? { telehealthUrl } : {}),
    ...(phone ? { phone } : {}),
    readsAsConfirmed: CONFIRMED.test(text),
    quote: sentenceAround(text, first.index, first.length),
  };
}
