/** Resource badges from completed verification calls. Per resource and question, the latest completed call that gave a decisive answer wins. */
import { verificationBadgeSchema, type VerificationBadge, type VerificationRequest, type VerifyQuestionKey } from './contract';
import { ANSWER_PHRASES, isEvidenceAnswer, verificationEvidenceId } from './evidence';

/** "Oct 24, 2026" (UTC, so the date matches the ISO day on the evidence claim). */
export function badgeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function badgesFor(requests: readonly VerificationRequest[]): Record<string, VerificationBadge[]> {
  const completed = requests
    .filter(r => r.status === 'completed' && r.result)
    .sort((a, b) => Date.parse(b.result!.calledAt) - Date.parse(a.result!.calledAt));
  const out: Record<string, VerificationBadge[]> = {};
  const seen = new Set<string>();
  for (const r of completed) {
    for (const a of r.result!.answers) {
      if (!isEvidenceAnswer(a)) continue;
      const slot = `${r.resourceKey}\u0000${a.key}`;
      if (seen.has(slot)) continue;
      const evidenceId = verificationEvidenceId(r.id, a.key as VerifyQuestionKey);
      if (!r.evidenceIds.includes(evidenceId)) continue;
      const value = a.value as 'yes' | 'no';
      const badge = verificationBadgeSchema.safeParse({
        resourceKey: r.resourceKey, key: a.key, value,
        label: `Verified by phone on ${badgeDate(r.result!.calledAt)}: ${ANSWER_PHRASES[a.key][value]}`,
        verifiedAt: r.result!.calledAt, evidenceId,
      });
      if (!badge.success) continue;
      seen.add(slot);
      (out[r.resourceKey] ??= []).push(badge.data);
    }
  }
  return out;
}
