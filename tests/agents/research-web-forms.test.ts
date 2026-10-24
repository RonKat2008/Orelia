import { describe, expect, it } from 'vitest';
import type { ExaPort } from '@/lib/agents/research/source-ports';
import { exaSearchTool } from '@/lib/agents/research/exa-tool';
import { ProvenanceTracker, finalizeOutput, type FinalizeRules } from '@/lib/agents/research/shared';
import { parsePlanContactPoints } from '@/lib/plan/contact-points';
import type { Resource } from '@/lib/contracts';

const NOW = () => new Date('2026-01-02T03:04:05Z');
const FORM_URL = 'https://www.northgate-health.org/request-an-appointment';
const OTHER_URL = 'https://www.northgate-health.org/about';
const pages = [
  { url: FORM_URL, title: 'Request an Appointment', text: 'Request an appointment at Northgate Health.\nFirst Name\nLast Name\nDate of Birth\nEmail\nPhone' },
  { url: OTHER_URL, title: 'About Northgate Health', text: 'Northgate Health treats rare sarcomas.' },
];
const rules: FinalizeRules = { allowedKinds: ['institution'] };
const inst = (id: string, refs: string[]): Resource => ({ kind: 'institution', id, name: 'Northgate Health', evidenceRefs: refs }) as Resource;

async function trackerAfterSearch(): Promise<ProvenanceTracker> {
  const tracker = new ProvenanceTracker(NOW);
  const exa: ExaPort = { search: async () => pages };
  await exaSearchTool(exa, tracker).handler({ query: 'northgate' } as never);
  return tracker;
}

describe('research web-form stamping', () => {
  it('stamps a web_form row for a record evidenced by an online form page', async () => {
    // Arrange
    const tracker = await trackerAfterSearch();
    // Act
    const out = finalizeOutput({ records: [inst('i1', [FORM_URL])], evidence: [{ claimType: 'fact', claim: 'Request an appointment at Northgate Health', sourceUrl: FORM_URL }] }, tracker, rules);
    // Assert
    const form = out.evidence.find((e) => e.claimType === 'contact_point.web_form.intake_form');
    expect(form).toMatchObject({ claim: FORM_URL, sourceUrl: FORM_URL, sourceKind: 'exa', fetchedAt: NOW().toISOString() });
    expect(out.records[0]?.evidenceRefs).toContain(form?.id);
    expect(parsePlanContactPoints(out.evidence.map((e) => ({ ...e, id: e.id ?? '' }))).map((p) => p.channel)).toEqual(['web_form']);
  });

  it('never stamps a form for a record evidenced only by other URLs, nor accepts model-written form rows', async () => {
    // Arrange
    const tracker = await trackerAfterSearch();
    // Act
    const out = finalizeOutput({
      records: [inst('i2', [OTHER_URL])],
      evidence: [
        { claimType: 'fact', claim: 'Northgate Health treats rare sarcomas', sourceUrl: OTHER_URL },
        { claimType: 'contact_point.web_form.intake_form', claim: FORM_URL, sourceUrl: OTHER_URL },
      ],
    }, tracker, rules);
    // Assert
    expect(out.evidence.some((e) => e.claimType.startsWith('contact_point'))).toBe(false);
    expect(tracker.webFormsFor(FORM_URL)).toHaveLength(1);
    expect(tracker.webFormsFor(OTHER_URL)).toEqual([]);
  });
});
