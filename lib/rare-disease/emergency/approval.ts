/**
 * Pure approval rules. A card is approved only while the stored approval's content hash equals the hash of the card
 * built from today's inputs, facts and records. Editing the inputs clears the approval, the snapshot and the share.
 */
import type { ApprovalState, ApprovedSnapshot, CardContent, CardInputs, EmergencyRecord, ShareInfo, ShareStatus } from './contract';
import { isEmptyCard } from './filter';
import { contentHash as defaultHash } from './hash';

export function emptyRecord(now: Date): EmergencyRecord {
  return { version: 1, inputs: { contacts: [], careTeam: [] }, approval: null, snapshot: null, share: null, updatedAt: now.toISOString() };
}

const revoked = (share: ShareInfo | null, now: Date): ShareInfo | null =>
  share && !share.revokedAt ? { ...share, revokedAt: now.toISOString() } : share;

/** New inputs: same inputs are a no-op; anything else bumps the version and clears approval and sharing. */
export function withInputs(record: EmergencyRecord, inputs: CardInputs, now: Date): EmergencyRecord {
  if (JSON.stringify(record.inputs) === JSON.stringify(inputs)) return record;
  return {
    ...record,
    version: record.version + 1,
    inputs: structuredClone(inputs),
    approval: null,
    snapshot: null,
    share: revoked(record.share, now),
    updatedAt: now.toISOString(),
  };
}

export type ApproveResult = { ok: true; record: EmergencyRecord } | { ok: false; error: 'stale' | 'empty' };

/** The patient approves exactly the version and content hash they saw; anything else is stale. */
export function approveRecord(
  record: EmergencyRecord, content: CardContent, seen: { version: number; contentHash: string }, now: Date,
  hash: (c: CardContent) => string = defaultHash,
): ApproveResult {
  const current = hash(content);
  if (seen.version !== record.version || seen.contentHash !== current) return { ok: false, error: 'stale' };
  if (isEmptyCard(content)) return { ok: false, error: 'empty' };
  const approvedAt = now.toISOString();
  return {
    ok: true,
    record: {
      ...record,
      approval: { approvedAt, contentHash: current, version: record.version },
      snapshot: { content: structuredClone(content), contentHash: current, approvedAt },
      updatedAt: approvedAt,
    },
  };
}

export function approvalState(record: EmergencyRecord, currentHash: string): ApprovalState {
  if (!record.approval) return 'needs_approval';
  return record.approval.contentHash === currentHash && record.approval.version === record.version ? 'approved' : 'changed';
}

/** The approved snapshot, only while it still matches the current card. */
export function approvedSnapshot(record: EmergencyRecord, currentHash: string): ApprovedSnapshot | null {
  if (approvalState(record, currentHash) !== 'approved' || !record.snapshot) return null;
  return record.snapshot.contentHash === currentHash ? record.snapshot : null;
}

export function withShare(record: EmergencyRecord, share: ShareInfo): EmergencyRecord {
  return { ...record, share: { ...share } };
}

export function withoutShare(record: EmergencyRecord, now: Date): EmergencyRecord {
  return { ...record, share: revoked(record.share, now) };
}

export function shareStatus(share: ShareInfo, now: Date): ShareStatus {
  if (share.revokedAt) return 'revoked';
  return new Date(share.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
}
