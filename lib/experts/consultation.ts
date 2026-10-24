import { cleanField } from '@/lib/agents/research/untrusted';
import type { ExaResult } from '@/lib/agents/research/source-ports';
import { pageMatchesInstitution } from './affiliation';

export const CONSULT_PATTERN = /second opinion|e-?consult|remote consult|virtual consult|expert consult|physician-to-physician|provider-to-provider/i;

export const consultationQuery = (institution: string): string =>
  `"${institution}" second opinion OR e-consult OR remote consultation program`;

export interface AcceptedPage { url: string; title: string }

const safeHttp = (u: string): string | null => {
  try { const p = new URL(u); return (p.protocol === 'https:' || p.protocol === 'http:') && !p.username && !p.password ? p.href : null; } catch { return null; }
};

/**
 * Split Exa results for one institution: pages that belong to it, and the subset whose title/sanitized text
 * describes a consultation program. Page text is only tested against the pattern, never copied into claims.
 */
export function classifyInstitutionPages(institution: string, results: readonly ExaResult[]): { institutionPage: AcceptedPage | null; consultation: AcceptedPage | null } {
  let institutionPage: AcceptedPage | null = null;
  let consultation: AcceptedPage | null = null;
  for (const r of results) {
    const url = safeHttp(r.url);
    const title = cleanField(r.title, 100) ?? '';
    if (!url || !title || !pageMatchesInstitution(institution, { url, title })) continue;
    const page = { url, title };
    institutionPage ??= page;
    const text = cleanField(r.text, 4000) ?? '';
    if (!consultation && CONSULT_PATTERN.test(`${title} ${text}`)) consultation = page;
  }
  return { institutionPage, consultation };
}
