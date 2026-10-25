/**
 * Deterministic (no model) detector for online forms a fetched page LINKS to. Aid and program pages are landing pages
 * ("Patient Medical Travel Grant ... Apply online"): the form lives behind a link, so the page-is-a-form detector in
 * web-forms.ts never fires on them. A form URL is stamped only when it is an actual link of the fetched page:
 *   - a markdown link `[Apply online](https://...)` or an HTML `<a href="...">Apply now</a>` in the fetched content, or
 *   - an entry of the page's own link list (Exa `extras.links`), which carries no anchor text, so the page text must
 *     also speak of applying / referring / requesting an appointment.
 * The link must name a form (anchor text, path or apply-portal host), stay on the page's own site (same registrable
 * domain), be http(s) without credentials, and not be a document, login, donation, job or professional-only route.
 * Bare URLs in prose are never mined, and a page linking several different forms of one kind (a directory of per-disease
 * applications) is ambiguous, so it yields none of that kind.
 */
import type { WebFormOrigin } from '../plan/contact-points';
import { normalizeHttpUrl } from '../plan/contact-points';

export interface PageLinks {
  url: string;
  text?: string;
  /** The page's own outgoing links as the fetcher returned them (absolute or relative); no anchor text. */
  links?: readonly string[];
}

export interface LinkedForm {
  origin: WebFormOrigin;
  url: string;
}

/** Bound the work on hostile or huge pages. */
const MAX_LINKS = 200;
const MAX_ANCHOR_CHARS = 120;

const REFERRAL = /\b(?:referrals?|refer (?:a |your )?patients?|make a referral)\b/i;
const APPLICATION = /\b(?:apply|application|applications|applicant portal|enroll|enrollment|enrolment|grant request|request (?:assistance|financial (?:aid|assistance)))\b/i;
const INTAKE = /\b(?:request (?:an? )?appointments?|appointment requests?|schedule (?:an? )?appointments?|intake(?: forms?)?|new patient (?:forms?|registration|intake|requests?))\b/i;
/** First host label of a dedicated application portal (financialaid.example.org, apply.example.org ...). */
const PORTAL_HOST = /^(?:apply|applications?|applicants?|enroll(?:ment)?|portal|financialaid|assistance|grants?)$/i;

/** Page prose that makes an anchor-less link list trustworthy for each origin. */
const PAGE_WORDING: Record<WebFormOrigin, RegExp> = {
  application_form: /\b(?:apply|applying|applications?|enroll(?:ment)?)\b/i,
  referral_form: /\b(?:refer|referrals?)\b/i,
  intake_form: /\b(?:appointments?|intake)\b/i,
};

const DOCUMENT = /\.(?:pdf|docx?|pptx?|xlsx?|rtf|png|jpe?g|gif|svg|webp|zip)$/i;
const FILE_ROUTE = /\b(?:get ?file|download|uploads?|files?|images?|assets?)\b/i;
/** Never a patient/family form route. */
const EXCLUDED = /\b(?:careers?|jobs?|employment|hiring|volunteer(?:ing|s)?|donat(?:e|ion|ions)|give|giving|newsletter|subscribe|sign[ -]?in|log[ -]?in|logout|register[ -]for[ -](?:an? )?event|residency|fellowships?|internships?|vendors?|suppliers?|press|media|sponsors?|scholarships?)\b/i;
/** Applications for professionals or organizations, not for the patient ("/apply-providers/", "/apply-nonprofits/"). */
const NOT_PATIENT_APPLICATION = /\b(?:providers?|pharmac(?:y|ies)|nonprofits?|organizations?|partners?|employers?|physicians?|clinicians?)\b/i;

type Strength = 3 | 2 | 1;
interface Candidate { origin: WebFormOrigin; url: string; strength: Strength }

/** Path words with separators and camelCase split ("/Home/WebEnroll" -> "Home Web Enroll"). */
function pathWords(url: URL): string {
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  return path.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[/_\-.+=]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function originIn(text: string): WebFormOrigin | null {
  if (REFERRAL.test(text)) return 'referral_form';
  if (APPLICATION.test(text)) return 'application_form';
  if (INTAKE.test(text)) return 'intake_form';
  return null;
}

/** Last two host labels (three for short second-level labels such as co.uk); good enough to keep links on-site. */
function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.');
  const take = labels.length > 2 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3 ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Absolute, normalized, fragment-free, same-site http(s) URL for an href, or null. */
function resolveHref(href: string, page: URL): URL | null {
  const raw = href.trim();
  if (!raw || /^(?:mailto|tel|javascript|data|sms):/i.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw, page); } catch { return null; }
  if (/^(?:#|\/\/)/.test(raw) && url.pathname === page.pathname) return null;
  const normalized = normalizeHttpUrl(url.href);
  if (!normalized) return null;
  url = new URL(normalized);
  if (siteOf(url.hostname) !== siteOf(page.hostname)) return null;
  return url;
}

const patientFacing = (origin: WebFormOrigin, naming: string): boolean => origin !== 'application_form' || !NOT_PATIENT_APPLICATION.test(naming);

/** One candidate for a link, or null when it is not a patient-facing form link. */
function candidate(href: string, anchor: string | null, page: URL, pageText: string): Candidate | null {
  const url = resolveHref(href, page);
  if (!url) return null;
  const words = pathWords(url);
  const anchorText = (anchor ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ANCHOR_CHARS);
  // The fragment and query are checked too ("/#/login"), then dropped from the stamped URL only when it is a fragment.
  const naming = `${words} ${url.hash.replace(/[#/_\-]+/g, ' ')} ${anchorText}`;
  if (DOCUMENT.test(url.pathname) || FILE_ROUTE.test(words) || EXCLUDED.test(naming)) return null;
  url.hash = '';
  const fromAnchor = anchorText ? originIn(anchorText) : null;
  const fromPath = originIn(words);
  const portal = PORTAL_HOST.test(url.hostname.split('.')[0] ?? '') && (url.pathname === '/' || !!fromPath);
  if (fromAnchor) return patientFacing(fromAnchor, naming) ? { origin: fromAnchor, url: url.href, strength: fromPath || portal ? 3 : 2 } : null;
  if (anchorText) return null; // an anchor that says something else ("Learn more") is not an application link
  const origin = fromPath ?? (portal ? 'application_form' : null);
  if (!origin || !patientFacing(origin, naming) || !PAGE_WORDING[origin].test(pageText)) return null;
  return { origin, url: url.href, strength: fromPath ? 2 : 1 };
}

const MARKDOWN_LINK = /(!?)\[([^\]\n]{1,120})\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]{0,400}?)<\/a>/gi;

function anchoredLinks(text: string): Array<{ href: string; anchor: string }> {
  const out: Array<{ href: string; anchor: string }> = [];
  for (const m of text.matchAll(MARKDOWN_LINK)) if (!m[1]) out.push({ href: m[3], anchor: m[2] });
  for (const m of text.matchAll(HTML_ANCHOR)) out.push({ href: m[2].replace(/&amp;/g, '&'), anchor: m[3] });
  return out.slice(0, MAX_LINKS);
}

/** Online forms this fetched page links to, at most one per origin (none when ambiguous); [] on any failure. */
export function linkedWebForms(page: PageLinks): LinkedForm[] {
  try {
    const pageUrl = new URL(normalizeHttpUrl(page.url ?? '') ?? '');
    const text = page.text ?? '';
    const listed = Array.isArray(page.links) ? page.links.filter((l): l is string => typeof l === 'string').slice(0, MAX_LINKS) : [];
    const candidates = [
      ...anchoredLinks(text).map((l) => candidate(l.href, l.anchor, pageUrl, text)),
      ...listed.map((href) => candidate(href, null, pageUrl, text)),
    ].filter((c): c is Candidate => c !== null);
    const origins: WebFormOrigin[] = ['application_form', 'referral_form', 'intake_form'];
    return origins.flatMap((origin) => {
      const mine = candidates.filter((c) => c.origin === origin);
      if (!mine.length) return [];
      const top = Math.max(...mine.map((c) => c.strength));
      const urls = [...new Set(mine.filter((c) => c.strength === top).map((c) => c.url))];
      return urls.length === 1 ? [{ origin, url: urls[0] }] : [];
    });
  } catch {
    return [];
  }
}
