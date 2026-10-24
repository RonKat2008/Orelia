import { describe, expect, it } from 'vitest';
import { MemoryCoordinationStore } from '@/lib/coordination/store';
import type { Doctor, RequirementsChecklist } from '@/lib/coordination/contract';

const caseId = '11111111-1111-4111-8111-111111111111';
const now = '2026-10-24T00:00:00.000Z';
const checklist = (version: number): RequirementsChecklist => ({
  caseId, resourceKey: 'institution:abc-123', name: 'Synthetic Center', requirements: [], checkedUrls: [],
  unavailableReason: 'none found', version, createdAt: now, updatedAt: now,
});

describe('MemoryCoordinationStore', () => {
  it('saves, reads and lists validated records per case and kind', async () => {
    const store = new MemoryCoordinationStore();
    await store.save(caseId, 'checklist', 'institution:abc-123', checklist(1));
    expect((await store.get(caseId, 'checklist', 'institution:abc-123'))?.name).toBe('Synthetic Center');
    expect(await store.list(caseId, 'checklist')).toHaveLength(1);
    expect(await store.list(caseId, 'packet')).toHaveLength(0);
  });

  it('compare-and-set refuses a stale version', async () => {
    const store = new MemoryCoordinationStore();
    await store.save(caseId, 'checklist', 'k', checklist(1));
    expect(await store.save(caseId, 'checklist', 'k', checklist(2), 2)).toBeNull();
    expect(await store.save(caseId, 'checklist', 'k', checklist(2), 1)).not.toBeNull();
  });

  it('rejects invalid records and returns copies callers cannot mutate', async () => {
    const store = new MemoryCoordinationStore();
    expect(await store.save(caseId, 'doctor', 'x', { name: '' } as unknown as Doctor)).toBeNull();
    const doctor: Doctor = { id: '22222222-2222-4222-8222-222222222222', caseId, name: 'Dr. Synthetic', practice: null, email: 'dr@example.test', npi: null, verified: false, verificationReason: null, createdAt: now };
    await store.save(caseId, 'doctor', doctor.id, doctor);
    const read = await store.get(caseId, 'doctor', doctor.id);
    read!.name = 'changed';
    expect((await store.get(caseId, 'doctor', doctor.id))?.name).toBe('Dr. Synthetic');
  });
});
