/**
 * Deterministic (no model) online-form detector over a fetched Exa page. Conservative by design: a page is an
 * online intake / referral / application form only when BOTH
 *   (a) its URL path or title names such a form (request-an-appointment, new-patient, refer-a-patient, apply ...), and
 *   (b) its fetched text carries form evidence: label-only lines for at least 3 distinct typical fields
 *       (First name, Date of birth, Email, Zip ...), or 2 such fields plus explicit form wording
 *       ("fill out the form", "submit", "required field"). A bare "Contact us" page needs 3 fields incl. message + email.
 * Here the form URL is the page URL itself; linked forms come only from the page's actual links (form-links.ts), never
 * from URLs in prose. Job, volunteer, donation,
 * newsletter and login pages, and documents (PDF/DOC), never count.
 */
import type { Evidence } from '../contracts/evidence';
import type { ExaPage } from '../sources/exa';
import { normalizeHttpUrl, webFormEvidence, type WebFormOrigin, type WebFormPoint } from '../plan/contact-points';
import { linkedWebForms } from './form-links';

const MIN_FIELDS = 3;
const MIN_FIELDS_WITH_WORDING = 2;
/** Longest line still treated as a bare field label. */
const MAX_LABEL_CHARS = 60;

const DOCUMENT = /\.(?:pdf|docx?|pptx?|xlsx?|rtf)$/i;
/** Pages that look like forms but are never a patient/family contact route. */
const EXCLUDED = /\b(?:careers?|jobs?|employment|hiring|volunteer(?:ing)?|donat(?:e|ion|ions)|giving|newsletter|subscribe|sign[ -]?in|log[ -]?in|register[ -]for[ -](?:an? )?event|residency|fellowships?|internships?|vendor|supplier|press|media)\b/i;

const REFERRAL = /\b(?:refer(?:ral)?s? (?:a )?patients?|refer a patient|patient referrals?|physician referrals?|provider referrals?|online referrals?|referral (?:form|request))\b/i;
const APPLICATION = /\b(?:apply(?: now| online| for (?:assistance|aid|a grant|financial (?:aid|assistance)|help))?|application(?: form)?|grant application|assistance application|request (?:[a-z]+ )?(?:assistance|financial aid|case management))\b/i;
const INTAKE = /\b(?:request (?:an? )?appointments?|web ?appointments?|appointments? requests?|schedule (?:an? )?appointments?|book (?:an? )?appointments?|new patients? (?:form|forms|intake|registration|appointments?|requests?)|patient intake|intake forms?|second opinion requests?|request (?:a )?second opinions?|contact (?:us )?form)\b/i;

/** Typical field labels; a line must consist of the label alone (plus required/optional markers). */
const FIELDS: ReadonlyArray<[string, RegExp]> = [
  ['first_name', /^(?:first|given) name$/],
  ['last_name', /^(?:last|family) name$|^surname$/],
  ['name', /^(?:full )?name$/],
  ['dob', /^(?:date of birth|birth ?date|dob)(?: mm\/dd\/yyyy)?$/],
  ['email', /^e-?mail(?: address)?$/],
  ['phone', /^(?:(?:phone|telephone|mobile|cell)(?: number)?|best phone(?: number)?)$/],
  ['zip', /^(?:zip(?: code)?|postal code)$/],
  ['address', /^(?:street )?address(?: line 1)?$/],
  ['city', /^city$/],
  ['state', /^state$/],
  ['reason', /^reason for (?:visit|appointment|referral|request|contact|your visit)$/],
  ['insurance', /^(?:insurance|insurance (?:provider|plan|carrier|company)|health insurance)$/],
  ['diagnosis', /^(?:diagnosis|condition|primary diagnosis)$/],
  ['message', /^(?:message|comments?|questions?|how can we help(?: you)?)$/],
  ['preferred', /^preferred (?:date|time|location|contact method|method of contact|language)$/],
  ['referring', /^referring (?:physician|provider|doctor|practice)(?: name)?$/],
  ['income', /^(?:annual |monthly |total )?(?:household )?income$/],
  ['household', /^household size$|^number of (?:people|persons) in household$/],
  ['gender', /^(?:gender|sex)$/],
];
/** A plain "Contact us" page counts only with a stricter field set (a message box plus email). */
const CONTACT = /\bcontact(?: us)?\b/i;
const PASSWORD = /^(?:password|confirm password)$/;
const FORM_WORDING = /\b(?:fill (?:out|in) (?:the|this|our)(?: online)? form|complete (?:the|this|our)(?: online)? form|submit (?:the|this|your)?(?: form| request| referral| application)?|required fields?|indicates (?:a )?required)\b/i;

/** Lowercased label with leading "patient's / your / parent" and trailing markers ("*", ":", "(required)") removed. */
function labelOf(line: string): string | null {
  if (line.length > MAX_LABEL_CHARS) return null;
  const label = line.toLowerCase()
    .replace(/\((?:required|optional)\)/g, ' ')
    .replace(/[*:?.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:patient'?s?|your|parent(?:\/guardian)?'?s?|caregiver'?s?) /, '');
  return label || null;
}

/** Distinct field kinds found as bare label lines; null when the page asks for a password (a login form). */
function fieldKinds(text: string): Set<string> | null {
  const kinds = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const label = labelOf(line.trim());
    if (!label) continue;
    if (PASSWORD.test(label)) return null;
    for (const [kind, pattern] of FIELDS) if (pattern.test(label)) kinds.add(kind);
  }
  return kinds;
}

/** Path segments and title as plain words ("request-an-appointment" -> "request an appointment"). */
function namingText(url: URL, title: string | undefined): string {
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  return `${path.replace(/[/_\-.+]+/g, ' ')} ${title ?? ''}`.replace(/\s+/g, ' ').trim();
}

type Naming = { origin: WebFormOrigin; strictContact: boolean };

function originOf(naming: string): Naming | null {
  if (REFERRAL.test(naming)) return { origin: 'referral_form', strictContact: false };
  if (APPLICATION.test(naming)) return { origin: 'application_form', strictContact: false };
  if (INTAKE.test(naming)) return { origin: 'intake_form', strictContact: false };
  if (CONTACT.test(naming)) return { origin: 'intake_form', strictContact: true };
  return null;
}

/**
 * The page says, in its own words, that it IS a form ("To fill out this form, you'll need..."). Many real intake
 * pages render their fields with JavaScript, so the fetched text has no field labels; this wording, together with
 * an explicit form name in the URL/title, is enough (never for a bare "Contact us" page).
 */
const SELF_DESCRIBED = /\b(?:(?:to )?fill (?:out|in) this (?:online )?form|complete this (?:online )?(?:form|request|application)|(?:use|submit) this (?:online )?form|this (?:form|request|application) (?:should|will) take|fill out the (?:online )?form below|complete the (?:online )?form below)\b/i;

function hasFormEvidence(text: string, strictContact: boolean): boolean {
  const kinds = fieldKinds(text);
  if (!kinds) return false;
  if (!strictContact && SELF_DESCRIBED.test(text)) return true;
  if (strictContact) return kinds.size >= MIN_FIELDS && kinds.has('message') && kinds.has('email');
  return kinds.size >= MIN_FIELDS || (kinds.size >= MIN_FIELDS_WITH_WORDING && FORM_WORDING.test(text));
}

/**
 * Online forms for a fetched page: the page itself when it IS a form, plus forms it links to (form-links.ts), e.g. a
 * grant program page's "Apply online" link. sourceUrl is always the fetched page. [] when none (never throws).
 */
export function webFormsOnPage(page: ExaPage): WebFormPoint[] {
  const own = pageAsForm(page);
  const linked = linkedWebForms(page)
    .filter((l) => !own.some((o) => o.url === l.url))
    .map((l): WebFormPoint => ({ origin: l.origin, url: l.url, sourceUrl: page.url, sourceKind: 'exa' }));
  return [...own, ...linked];
}

/** The page itself as an online form contact point, or [] (never throws). */
function pageAsForm(page: ExaPage): WebFormPoint[] {
  try {
    const raw = normalizeHttpUrl(page.url ?? '');
    if (!raw || !page.text?.trim()) return [];
    const url = new URL(raw);
    url.hash = '';
    if (DOCUMENT.test(url.pathname)) return [];
    const naming = namingText(url, page.title);
    if (EXCLUDED.test(naming)) return [];
    const named = originOf(naming);
    if (!named || !hasFormEvidence(page.text, named.strictContact)) return [];
    // sourceUrl stays the page URL exactly as the tool returned it (provenance is keyed on it).
    return [{ origin: named.origin, url: url.href, sourceUrl: page.url, sourceKind: 'exa' }];
  } catch {
    return [];
  }
}

/** Code-stamped contact_point.web_form.<origin> evidence rows (with ids) for a fetched page; [] when it is no form. */
export function webFormRowsFromPage(page: ExaPage, fetchedAt: string): Array<Evidence & { id: string }> {
  return webFormsOnPage(page).flatMap((wf) => {
    const row = webFormEvidence(wf, fetchedAt);
    return row?.id ? [row as Evidence & { id: string }] : [];
  });
}
