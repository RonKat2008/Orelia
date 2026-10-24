import { historyEventSchema, type DocType, type EventKind, type HistoryDocument, type HistoryEvent } from './contract';
import { classifyVariantTerm } from './clinical-terms';
import { findDates } from './dates';
import { inferDocType } from './doc-type';

interface Line { text: string; start: number; end: number }
interface Section { date: string | null; heading: string | null; first: number; last: number }
type Draft = Omit<HistoryEvent, 'id'>;

const MAX_FINDINGS = 12;
const MAX_FINDING_CHARS = 300;
const MAX_FIELD = 200;

const HEADING_RE = /^\s{0,3}#{1,6}\s/;
const LABEL_RE = /^\W*(?:final |primary |working )?(?:diagnos[ie]s|impression|assessment|plan|gene|variant|classification|interpretation|result|findings?|medications?|indication|conclusion|summary)\b\s*[:\-–—]/i;
const KEY_TERM_RE = /\b(?:INI-?1|SMARCB1|CD34|ERG|EMA|c\.\d|pathogenic|IgG4)/i;

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    lines.push({ text: raw, start, end: start + raw.length });
    start += raw.length + 1;
  }
  return lines;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n).trimEnd() : s);
const stripMarks = (s: string): string => s.replace(/\*\*|__/g, '').replace(/^[\s\-–—:|·,.]+|[\s\-–—:|·,]+$/g, '').trim();

// ---- sections ------------------------------------------------------------------------------------------------
function headingTitle(line: string): string {
  let t = line.replace(/^\s*#{1,6}\s*/, '');
  const dates = findDates(t, { bareYear: true });
  const first = dates[0];
  if (first) t = t.slice(0, first.index) + ' ' + t.slice(first.index + first.length);
  return stripMarks(t);
}

const DOC_DATE_LABEL_RE = /date of (?:visit|service|collection|biopsy|procedure|study|exam|encounter|admission|surgery|discharge)|visit date|encounter|collected|specimen|date of /i;
const DOC_DATE_ANY_LABEL_RE = /\bdate\b|\breported\b|\bdated\b/i;

function documentDate(lines: Line[]): string | null {
  for (const re of [DOC_DATE_LABEL_RE, DOC_DATE_ANY_LABEL_RE]) {
    for (const l of lines) {
      if (!re.test(l.text)) continue;
      const d = findDates(l.text, { bareYear: true })[0];
      if (d) return d.iso;
    }
  }
  for (const l of lines) {
    const d = findDates(l.text)[0];
    if (d) return d.iso;
  }
  return null;
}

function detectSections(lines: Line[]): Section[] {
  const starts: { line: number; date: string; heading: string | null }[] = [];
  lines.forEach((l, i) => {
    if (!HEADING_RE.test(l.text)) return;
    const d = findDates(l.text, { bareYear: true })[0];
    if (d) starts.push({ line: i, date: d.iso, heading: headingTitle(l.text) });
  });
  if (starts.length === 0) {
    lines.forEach((l, i) => {
      if (l.text.length > 160) return;
      const stripped = l.text.replace(/^[\s>*_•\-–]+/, '');
      const d = findDates(stripped, { bareYear: true })[0];
      const yearOnly = d !== undefined && d.iso.length === 4;
      if (d && d.index === 0 && (!yearOnly || /^\s*(?:[:\-–—]|$)/.test(stripped.slice(d.length)))) {
        const rest = stripMarks(stripped.slice(d.length));
        starts.push({ line: i, date: d.iso, heading: rest ? clip(rest, MAX_FIELD) : null });
      }
    });
  }
  if (starts.length === 0) {
    const titleLine = lines.find(l => /^\s{0,3}#\s/.test(l.text));
    return [{ date: documentDate(lines), heading: titleLine ? headingTitle(titleLine.text) : null, first: 0, last: lines.length - 1 }];
  }
  return starts.map((s, i) => ({
    date: s.date, heading: s.heading, first: s.line, last: (starts[i + 1]?.line ?? lines.length) - 1,
  }));
}

// ---- classification ------------------------------------------------------------------------------------------
const KIND_RULES: [EventKind, RegExp][] = [
  ['genetic_test', /genetic|variant|sequenc|gene panel|exome|genome|mutation|germline|molecular/i],
  ['imaging', /\b(?:MRI|MRA|CT|CTA|PET|ultrasound|echo\w*|x-?ray|radiograph\w*|imaging|angiogra\w*|radiolog\w*|scan)\b/i],
  ['hospitalization', /discharge|admission|admitted|hospital|inpatient/i],
  ['procedure', /surg\w*|operat\w*|biops\w*|resection|excision|colectomy|procedure|pathology|endoscop\w*|ERCP|stent/i],
  ['lab', /\blabs?\b|laborator\w*|blood ?work|\bCBC\b|serum|titer|chemistry|urinalysis/i],
  ['medication', /medication|prescri\w*|\brx\b|\bdose\b/i],
  ['specialist_visit', /visit|consult\w*|clinic|office|follow-?up|appointment|evaluation|referral|letter|seen by|encounter|progress/i],
  ['diagnosis', /diagnos\w*/i],
];
const DOC_TYPE_KIND: Partial<Record<DocType, EventKind>> = {
  genetic_report: 'genetic_test', imaging_report: 'imaging', lab_report: 'lab', discharge_summary: 'hospitalization',
  visit_note: 'specialist_visit', letter: 'specialist_visit',
};

function matchKind(text: string): EventKind | null {
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  return null;
}

function classifySection(heading: string | null, body: string, docType: DocType): EventKind {
  return (heading ? matchKind(heading) : null) ?? DOC_TYPE_KIND[docType] ?? matchKind(body.slice(0, 400)) ?? 'note';
}

// ---- provider / institution ----------------------------------------------------------------------------------
const NAME = "[A-Z][A-Za-z'’-]+";
const PROVIDER_LABEL_RE = /^\W*(?:provider|physician|author|clinician|attending|referring (?:physician|provider)|ordering (?:physician|provider)|pathologist|radiologist|geneticist|consulting geneticist|rheumatologist|oncologist|surgeon|signed by|electronically signed(?: by)?|seen by)\W*[:|]\s*(.+)$/im;
const DR_RE = new RegExp(`\\bDr\\.?\\s+(${NAME}(?:\\s+${NAME}){0,2})`);
const CREDENTIAL_RE = new RegExp(`\\b(${NAME}(?:\\s+[A-Z]\\.)?(?:\\s+${NAME}){1,2}),\\s*(?:MD|M\\.D\\.|DO|PhD|NP|PA-C|MBBS)\\b`);
const INSTITUTION_LABEL_RE = /^\W*(?:institution|facility|hospital|clinic|laboratory|lab|practice|center|centre|site)\W*[:|]\s*(.+)$/im;
const INSTITUTION_RE = /\b((?:[A-Z][\w&'’.-]*\s+){1,5}(?:Hospital|Clinic|Medical Center|Medical Centre|Laboratory|Laboratories|Institute|Cancer Center|Health System|Associates|Pathology Group|Genomics|Genetics))\b/;

function cleanValue(v: string): string {
  return clip(stripMarks(v.replace(/\|.*$/, '')), MAX_FIELD);
}

function findProvider(text: string): string | null {
  const labelled = PROVIDER_LABEL_RE.exec(text);
  if (labelled?.[1]) { const v = cleanValue(labelled[1]); if (v) return v; }
  const dr = DR_RE.exec(text); const cred = CREDENTIAL_RE.exec(text);
  const pick = dr && cred ? (dr.index <= cred.index ? dr : cred) : dr ?? cred;
  if (!pick) return null;
  return pick === dr ? `Dr. ${pick[1]}` : cleanValue(pick[0]);
}

function findInstitution(text: string): string | null {
  const labelled = INSTITUTION_LABEL_RE.exec(text);
  if (labelled?.[1]) { const v = cleanValue(labelled[1]); if (v) return v; }
  const m = INSTITUTION_RE.exec(text);
  return m ? clip(m[1]!.replace(/^The\s+/, ''), MAX_FIELD) : null;
}

// ---- findings ------------------------------------------------------------------------------------------------
const isStructural = (t: string): boolean =>
  t.trim().length < 6 || /^\s*\|?[\s:|-]+\|?\s*$/.test(t) || /^\s*-{3,}\s*$/.test(t) || /^\s*SYNTHETIC\b/.test(t) || HEADING_RE.test(t);

function pickFindings(lines: Line[]): string[] {
  const candidates = lines
    .filter(l => !isStructural(l.text))
    .map((l, order) => {
      const body = l.text.trim().replace(/^[-*•]\s+/, '');
      return { body: clip(body, MAX_FINDING_CHARS), order, score: LABEL_RE.test(body) ? 0 : KEY_TERM_RE.test(body) ? 1 : 2 };
    });
  return candidates
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, MAX_FINDINGS)
    .sort((a, b) => a.order - b.order)
    .map(c => c.body);
}

// ---- sub-events: diagnoses, variants, medications ------------------------------------------------------------
interface SubEvent { kind: EventKind; title: string; findings: string[]; start: number; end: number }

const DIAGNOSIS_LINE_RE = /^(\s*(?:[-*•]\s+)?(?:\*\*|__)?)((?:final |primary |working |clinical |new |principal )?(?:diagnos[ie]s|dx))(?:\*\*|__)?\s*[:\-–—]\s*(?:\*\*|__)?(.*)$/i;
const MED_LABEL_RE = /^(\s*(?:[-*•]\s+)?(?:\*\*|__)?)((?:current |discharge |home |active |admission )?(?:medications?|meds|rx))(?:\*\*|__)?\s*[:\-–—]\s*(?:\*\*|__)?(.*)$/i;
const BULLET_RE = /^(\s*(?:[-*•]|\d+[.)])\s+)(.+)$/;
const NO_MEDS_RE = /^(?:none|no (?:known )?(?:current )?medications?|n\/a|nil|nkda)\b/i;

function diagnosisSubEvents(lines: Line[], first: number, last: number): SubEvent[] {
  const out: SubEvent[] = [];
  for (let i = first; i <= last; i++) {
    const l = lines[i]!;
    const m = DIAGNOSIS_LINE_RE.exec(l.text);
    if (m && stripMarks(m[3] ?? '')) {
      const offset = (m[1] ?? '').length;
      out.push({ kind: 'diagnosis', title: clip(stripMarks(m[3]!), MAX_FIELD), findings: [clip(l.text.slice(offset).trim(), MAX_FINDING_CHARS)], start: l.start + offset, end: l.end });
    } else if (HEADING_RE.test(l.text) && /diagnos/i.test(l.text) && i < last) {
      const next = lines.slice(i + 1, last + 1).find(x => x.text.trim() && !HEADING_RE.test(x.text));
      if (next && !HEADING_RE.test(lines[i + 1]?.text ?? '') && stripMarks(next.text)) {
        const body = next.text.trim().replace(/^[-*•]\s+/, '');
        out.push({ kind: 'diagnosis', title: clip(stripMarks(body), MAX_FIELD), findings: [clip(body, MAX_FINDING_CHARS)], start: next.start + (next.text.length - next.text.trimStart().length), end: next.end });
      }
    }
  }
  return out;
}

function splitItems(value: string, base: number): { text: string; start: number; end: number }[] {
  const items: { text: string; start: number; end: number }[] = [];
  let depth = 0; let from = 0;
  const push = (to: number): void => {
    const raw = value.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (/[A-Za-z]{3,}/.test(text) && !NO_MEDS_RE.test(text.replace(/\*\*|__/g, ''))) items.push({ text, start: base + from + lead, end: base + from + lead + text.length });
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ';' || c === ',')) { push(i); from = i + 1; }
  }
  push(value.length);
  return items;
}

function medicationSubEvents(lines: Line[], first: number, last: number): SubEvent[] {
  const out: SubEvent[] = [];
  const add = (text: string, start: number, end: number): void => {
    const raw = clip(text.trim(), MAX_FINDING_CHARS);
    out.push({ kind: 'medication', title: clip(raw.replace(/\*\*|__/g, ''), MAX_FIELD), findings: [raw], start, end });
  };
  for (let i = first; i <= last; i++) {
    const l = lines[i]!;
    const m = MED_LABEL_RE.exec(l.text);
    if (!m) continue;
    const valueStart = l.start + l.text.length - (m[3] ?? '').length;
    for (const item of splitItems(m[3] ?? '', valueStart)) add(item.text, item.start, item.end);
    for (let j = i + 1; j <= last; j++) {
      const b = BULLET_RE.exec(lines[j]!.text);
      if (!b) { if (lines[j]!.text.trim() === '' && !(lines[j + 1] && BULLET_RE.test(lines[j + 1]!.text))) break; if (lines[j]!.text.trim() !== '') break; continue; }
      if (NO_MEDS_RE.test(b[2]!.trim())) continue;
      add(b[2]!, lines[j]!.start + b[1]!.length, lines[j]!.end);
      i = j;
    }
  }
  return out;
}

const VARIANT_RE = /c\.[^\s,;()|]+/;
const GENE_RE = /^[A-Z][A-Z0-9-]{1,9}$/;
const KV_RE = /^\s*(?:[-*•]\s+)?(?:\*\*|__)?(gene|variant|hgvs|cdna|nucleotide change|classification|interpretation|acmg classification|pathogenicity|zygosity|transcript|inheritance|evidence)(?:\*\*|__)?\s*[:\-–—]\s*(?:\*\*|__)?(.*)$/i;
const RECORD_LABELS = new Set(['variant', 'hgvs', 'cdna', 'nucleotide change', 'classification', 'interpretation', 'acmg classification', 'pathogenicity', 'zygosity', 'transcript', 'inheritance', 'evidence']);

function variantTitle(gene: string, variant: string): string {
  return clip(`${gene} ${variant}`, MAX_FIELD);
}

function variantSubEvents(lines: Line[], first: number, last: number): SubEvent[] {
  const out: SubEvent[] = [];
  const covered = new Set<number>();
  // key/value blocks: Gene: X / Variant: Y / Classification: Z
  for (let i = first; i <= last; i++) {
    const m = KV_RE.exec(lines[i]!.text);
    if (!m || m[1]!.toLowerCase() !== 'gene') continue;
    const gene = stripMarks(m[2] ?? '').split(/\s+/)[0] ?? '';
    const idx = [i]; let variant: string | null = null;
    for (let j = i + 1; j <= last; j++) {
      const t = lines[j]!.text;
      if (t.trim() === '') { continue; }
      const kv = KV_RE.exec(t);
      if (!kv || !RECORD_LABELS.has(kv[1]!.toLowerCase())) break;
      idx.push(j);
      variant ??= VARIANT_RE.exec(kv[2] ?? '')?.[0] ?? null;
    }
    if (!gene || !variant) continue;
    idx.forEach(n => covered.add(n));
    const a = lines[idx[0]!]!; const z = lines[idx[idx.length - 1]!]!;
    out.push({
      kind: 'genetic_test', title: variantTitle(gene.toUpperCase(), variant),
      findings: idx.map(n => clip(lines[n]!.text.trim().replace(/^[-*•]\s+/, ''), MAX_FINDING_CHARS)),
      start: a.start + (a.text.length - a.text.trimStart().length), end: z.end,
    });
  }
  // table rows: | COL3A1 | NM_... | c.1834G>A (p.Gly612Ser) | Het | Pathogenic |
  for (let i = first; i <= last; i++) {
    const t = lines[i]!.text;
    if (covered.has(i) || !t.trim().startsWith('|')) continue;
    const cells = t.split('|').map(c => stripMarks(c)).filter(Boolean);
    const variant = cells.map(c => VARIANT_RE.exec(c)?.[0]).find(Boolean);
    const gene = cells.find(c => GENE_RE.test(c) && !/^(?:NM|NP|ENST)/.test(c));
    if (!variant || !gene) continue;
    covered.add(i);
    out.push({
      kind: 'genetic_test', title: variantTitle(gene, variant), findings: [clip(t.trim(), MAX_FINDING_CHARS)],
      start: lines[i]!.start + (t.length - t.trimStart().length), end: lines[i]!.end,
    });
  }
  // messy free text: "... COL3A1 c.1834G>A ... likely pathogenic"
  for (let i = first; i <= last; i++) {
    const t = lines[i]!.text;
    if (covered.has(i) || t.trim().startsWith('|') || !classifyVariantTerm(t)) continue;
    const m = /\b([A-Z][A-Z0-9]{2,9})\b[^\n]{0,40}?(c\.[^\s,;()|]+)/.exec(t);
    if (!m) continue;
    out.push({
      kind: 'genetic_test', title: variantTitle(m[1]!, m[2]!), findings: [clip(t.trim(), MAX_FINDING_CHARS)],
      start: lines[i]!.start + (t.length - t.trimStart().length), end: lines[i]!.end,
    });
  }
  return out;
}

// ---- main ----------------------------------------------------------------------------------------------------
/** Deterministic, offline extraction. Ids are `${doc.id}:${index}`; every finding is a substring of doc.text. */
export function extractEventsWithRules(doc: HistoryDocument): HistoryEvent[] {
  const text = doc.text;
  const lines = splitLines(text);
  const docType = inferDocType(doc.title, text);
  const docProvider = findProvider(text);
  const docInstitution = findInstitution(text);
  const drafts: Draft[] = [];

  for (const section of detectSections(lines)) {
    const body = lines.slice(section.first, section.last + 1);
    const bodyText = body.map(l => l.text).join('\n');
    const content = body.filter(l => !isStructural(l.text));
    if (content.length === 0) continue;
    const start = lines[section.first]!.start + (lines[section.first]!.text.length - lines[section.first]!.text.trimStart().length);
    let end = lines[section.last]!.end;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (end <= start) continue;
    const provider = findProvider(bodyText) ?? docProvider;
    const institution = findInstitution(bodyText) ?? docInstitution;
    const base = { date: section.date, provider, institution, sourceDocId: doc.id };

    drafts.push({
      ...base, kind: classifySection(section.heading, bodyText, docType),
      title: clip(section.heading || doc.title, MAX_FIELD), findings: pickFindings(body.slice(1).length ? body.slice(HEADING_RE.test(body[0]!.text) ? 1 : 0) : body),
      span: { start, end },
    });
    const subs = [
      ...diagnosisSubEvents(lines, section.first, section.last),
      ...variantSubEvents(lines, section.first, section.last),
      ...medicationSubEvents(lines, section.first, section.last),
    ].sort((a, b) => a.start - b.start);
    for (const s of subs) {
      if (s.end <= s.start || !s.title) continue;
      drafts.push({ ...base, kind: s.kind, title: s.title, findings: s.findings, span: { start: s.start, end: s.end } });
    }
  }

  const events: HistoryEvent[] = [];
  drafts.forEach(d => {
    const parsed = historyEventSchema.safeParse({ ...d, id: `${doc.id}:${events.length}` });
    if (parsed.success) events.push(parsed.data);
  });
  return events;
}
