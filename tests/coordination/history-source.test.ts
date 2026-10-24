import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryHistoryStore, setHistoryStoreForTests } from '@/lib/history/store';
import { medicalHistorySource, getHistorySource } from '@/lib/coordination/packet/history';
import { fixtureEvents } from '../history/helpers';

const CASE = 'case-1';

describe('medicalHistorySource (lib/history wiring)', () => {
  let store: MemoryHistoryStore;
  beforeEach(() => { store = new MemoryHistoryStore(); setHistoryStoreForTests(store); });
  afterEach(() => setHistoryStoreForTests(undefined));

  it('is the default source for packets', () => {
    expect(getHistorySource().conflicts).toBeTypeOf('function');
  });

  it('falls back to case documents when the patient has no history records', async () => {
    const source = medicalHistorySource(() => ({ name: 'case_docs', load: async () => [{ id: 'd1', title: 'Intake', text: 'x' }] }));
    expect(await source.load(CASE)).toEqual([{ id: 'd1', title: 'Intake', text: 'x' }]);
    expect(source.name).toBe('case_docs');
    expect(await source.conflicts!(CASE)).toEqual([]);
  });

  it('serves the real history records and their conflicts, never resolved', async () => {
    const { docs, events } = await fixtureEvents('vascular-eds');
    for (const d of docs) await store.addDocument(d, events.filter(e => e.sourceDocId === d.id));
    const source = medicalHistorySource();
    const loaded = await source.load(CASE);
    expect(source.name).toBe('history');
    expect(loaded.map(d => d.id).sort()).toEqual(docs.map(d => d.id).sort());
    const conflicts = await source.conflicts!(CASE);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].text).toMatch(/^Records differ on /);
    expect(conflicts[0].sourceDocId).toBeTruthy();
  });
});
