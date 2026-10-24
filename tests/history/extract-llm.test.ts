import { describe, expect, it, vi } from 'vitest';
import { historyEventSchema } from '@/lib/history/contract';
import { extractEvents } from '@/lib/history/extract';
import { makeDoc } from './helpers';

const text = '## 2020-01-01 — Visit\nDiagnosis: vascular EDS\nPlan: follow up in clinic\n';
const doc = makeDoc('d1', 'Visit note', text);
const good = (findings: string[]) => JSON.stringify({ events: [{ date: '2020-01-01', kind: 'specialist_visit', title: 'Visit', provider: null, institution: null, findings }] });

describe('extractEvents', () => {
  it('uses rules when llm is not requested', async () => {
    const chatFn = vi.fn();
    const r = await extractEvents(doc, { chatFn });
    expect(r.extractedBy).toBe('rules');
    expect(chatFn).not.toHaveBeenCalled();
  });

  it('accepts valid grounded LLM output (also inside a code fence)', async () => {
    const chatFn = vi.fn().mockResolvedValue('```json\n' + good(['Diagnosis: vascular EDS']) + '\n```');
    const r = await extractEvents(doc, { llm: true, chatFn });
    expect(r.extractedBy).toBe('llm');
    expect(chatFn.mock.calls[0]![0].role).toBe('history');
    expect(r.events).toHaveLength(1);
    const e = r.events[0]!;
    expect(historyEventSchema.safeParse(e).success).toBe(true);
    expect(e.id).toBe('d1:0');
    expect(text.slice(e.span.start, e.span.end)).toContain('Diagnosis: vascular EDS');
  });

  it('drops ungrounded findings but keeps grounded ones', async () => {
    const chatFn = vi.fn().mockResolvedValue(good(['Diagnosis: vascular EDS', 'Patient has a made-up condition']));
    const r = await extractEvents(doc, { llm: true, chatFn });
    expect(r.extractedBy).toBe('llm');
    expect(r.events[0]!.findings).toEqual(['Diagnosis: vascular EDS']);
  });

  it('falls back to rules when every finding is ungrounded', async () => {
    const r = await extractEvents(doc, { llm: true, chatFn: vi.fn().mockResolvedValue(good(['invented'])) });
    expect(r.extractedBy).toBe('rules');
    expect(r.events.length).toBeGreaterThan(0);
  });

  it.each(['not json at all', '{"events":"nope"}', '{"events":[{"kind":"bogus","title":"x","findings":[]}]}'])('falls back on malformed output %s', async raw => {
    const r = await extractEvents(doc, { llm: true, chatFn: vi.fn().mockResolvedValue(raw) });
    expect(r.extractedBy).toBe('rules');
  });

  it('falls back when the model call throws', async () => {
    const r = await extractEvents(doc, { llm: true, chatFn: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(r.extractedBy).toBe('rules');
  });
});
