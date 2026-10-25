/**
 * Collapses the same organisation listed twice under slightly different names
 * ("Castleman Disease Collaborative Network" vs "... (CDCN)"). Pure; no I/O.
 * Two items are the same when, within one resource kind, their normalised names match or they share a
 * non-generic URL host. The better-ranked entry (lower rank, then higher score) is kept.
 */

export interface DedupableItem {
  targetKind: string;
  name: string;
  rank: number;
  score: number;
}

/** Hosts that many unrelated organisations share; never evidence of "same organisation". */
const SHARED_HOSTS = new Set([
  'clinicaltrials.gov', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'nih.gov', 'orpha.net', 'rarediseases.info.nih.gov',
  'forms.gle', 'docs.google.com', 'google.com', 'jotform.com', 'typeform.com', 'facebook.com', 'linkedin.com',
  'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'wikipedia.org', 'en.wikipedia.org',
]);

export function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/^\s*the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Host without a leading "www.", or null when the URL is missing, invalid or a shared platform. */
export function normalizeHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    for (const shared of SHARED_HOSTS) if (host === shared || host.endsWith(`.${shared}`)) return null;
    return host;
  } catch {
    return null;
  }
}

/** Names are only compared for organisations and institutions: two experts can share a name. Hosts: organisations only. */
const NAME_KINDS = new Set(['organization', 'institution']);
const HOST_KINDS = new Set(['organization']);

export function dedupeShortlist<T extends DedupableItem>(
  items: readonly T[],
  urlOf: (item: T) => string | null | undefined = () => null,
  /** An entry the patient can actually contact beats a better-ranked one that cannot be contacted. */
  usable: (item: T) => boolean = () => true,
): T[] {
  const isBetter = (a: T, b: T): boolean => {
    if (usable(a) !== usable(b)) return usable(a);
    return a.rank !== b.rank ? a.rank < b.rank : a.score > b.score;
  };
  const kept: { item: T; name: string; host: string | null }[] = [];
  for (const item of items) {
    const name = NAME_KINDS.has(item.targetKind) ? normalizeOrgName(item.name) : '';
    const host = HOST_KINDS.has(item.targetKind) ? normalizeHost(urlOf(item)) : null;
    const hit = kept.find(k => k.item.targetKind === item.targetKind && ((name !== '' && k.name === name) || (host !== null && k.host === host)));
    if (!hit) { kept.push({ item, name, host }); continue; }
    if (isBetter(item, hit.item)) { hit.item = item; hit.name = name; hit.host = host ?? hit.host; }
  }
  const winners = new Set(kept.map(k => k.item));
  return items.filter(i => winners.has(i));
}
