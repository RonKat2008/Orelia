import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MedicalAdviceError } from '@/lib/agents/runtime';
import type { RunStore } from '@/lib/agents/run-store';
import { createRuntimeClassifier, FixtureClassifier } from '@/lib/inbox/classifier';

const store = {} as RunStore;
const input = { channel: 'email' as const, body: 'Please call us.', caseId: 'case-1' };
const classifierThrowing = (error: unknown) => createRuntimeClassifier({ store, run: (async () => { throw error; }) as never });

describe('createRuntimeClassifier failure handling', () => {
  it('returns the unclear fallback when the model output trips the medical-advice screen', async () => {
    const res = await classifierThrowing(new MedicalAdviceError(['take 5mg'])).classify(input);
    expect(res.class).toBe('unclear');
  });
  it.each(['Offline fixture not found: msg-abc', 'Unsafe fixture path segment: ../x'])('returns the fallback for "%s"', async (message) => {
    expect((await classifierThrowing(new Error(message)).classify(input)).class).toBe('unclear');
  });
  it('rethrows unrelated errors rather than hiding an outage as "unclear"', async () => {
    await expect(classifierThrowing(new Error('503 upstream')).classify(input)).rejects.toThrow('503 upstream');
  });
  it('rethrows a non-Error rejection', async () => {
    await expect(classifierThrowing('boom').classify(input)).rejects.toBe('boom');
  });
  it('does not match the fixture-miss text unless it is the start of the message', async () => {
    await expect(classifierThrowing(new Error('wrapped: Offline fixture not found')).classify(input)).rejects.toThrow('wrapped');
  });
  it('uses an explicit offlineKey and client when supplied, and parses the run result', async () => {
    let seen: Record<string, unknown> = {};
    const client = {} as never;
    const run = (async (opts: Record<string, unknown>) => { seen = opts; return { class: 'unclear', confidence: 0.1, rationale: 'r' }; }) as never;
    const res = await createRuntimeClassifier({ store, run, client }).classify({ ...input, offlineKey: 'my-key', tools: [] });
    expect(seen).toMatchObject({ offlineKey: 'my-key', client, caseId: 'case-1' });
    expect(res.class).toBe('unclear');
  });
});

describe('createRuntimeClassifier: an over-long rationale', () => {
  it('is accepted from the model and shortened, so a real reply still becomes a task instead of a webhook 500', async () => {
    const body = 'Please send the most recent pathology report and recent lab results.';
    let schema: { safeParse(v: unknown): { success: boolean } } | undefined;
    const raw = { class: 'send_records', confidence: 0.9, rationale: 'They ask for records. '.repeat(30), quote: body };
    const run = (async (opts: { output: typeof schema }) => { schema = opts.output; return raw; }) as never;
    const res = await createRuntimeClassifier({ store, run }).classify({ ...input, body });
    expect(schema?.safeParse(raw).success).toBe(true);
    expect(res.class).toBe('send_records');
    expect(res.rationale.length).toBeLessThanOrEqual(300);
  });
});

describe('createRuntimeClassifier: output that still fails validation', () => {
  it('falls back to the unclear task (never leaves the contact stuck) when the model output fails validation after retry', async () => {
    const res = await classifierThrowing(new Error('Agent inbox output failed validation after retry: [too_big]')).classify(input);
    expect(res.class).toBe('unclear');
  });
  it('falls back to unclear when the returned object does not parse', async () => {
    const run = (async () => ({ class: 'not_a_class', confidence: 2 })) as never;
    expect((await createRuntimeClassifier({ store, run }).classify(input)).class).toBe('unclear');
  });
  it('accepts and shortens an over-long quote from a call transcript', async () => {
    const body = 'Agent: hello. Office: '.concat('we need the referral letter first. '.repeat(30));
    const run = (async () => ({ class: 'needs_referral', confidence: 0.8, rationale: 'Needs a referral.', quote: body.slice(0, 900) })) as never;
    const res = await createRuntimeClassifier({ store, run }).classify({ ...input, channel: 'voice' as never, body });
    expect(res.class).toBe('needs_referral');
    expect((res.quote ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('FixtureClassifier', () => {
  it('is empty and answers unclear/0 when the fixture directory does not exist', async () => {
    const c = new FixtureClassifier(path.join(os.tmpdir(), 'wayfinder-no-such-fixture-dir'));
    expect(c.size).toBe(0);
    expect(await c.classify({ body: 'anything' })).toEqual({ class: 'unclear', confidence: 0, rationale: 'No recorded classification' });
  });
  it('replays a recorded classification keyed by whitespace-normalized body and ignores non-json files', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wayfinder-fixtures-'));
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ event: { body: 'Please   send\nrecords' }, expected: { class: 'send_records', confidence: 0.9, rationale: 'asked for records' } }));
    writeFileSync(path.join(dir, 'notes.txt'), 'not a fixture');
    const c = new FixtureClassifier(dir);
    expect(c.size).toBe(1);
    expect((await c.classify({ body: 'Please send records' })).class).toBe('send_records');
    expect((await c.classify({ body: 'something else' })).class).toBe('unclear');
  });
  it('rejects a fixture whose expected classification is invalid', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wayfinder-fixtures-'));
    writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ event: { body: 'x' }, expected: { class: 'not_a_class', confidence: 2, rationale: '' } }));
    expect(() => new FixtureClassifier(dir)).toThrow();
  });
});
