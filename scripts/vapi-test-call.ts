/**
 * One real Vapi test call through the normal path: synthetic case + institution + voice contact -> consent (ticked
 * fields) -> draft (real call script) -> approve (WiredOutreachService: checkOutbound -> VapiChannel.send -> calls row).
 * The destination must already be on OUTBOUND_ALLOWLIST; the gate and the adapter both re-check it.
 *
 *   npx tsx scripts/vapi-test-call.ts --to +1XXXXXXXXXX            # dry run: creates rows, drafts, does not approve
 *   npx tsx scripts/vapi-test-call.ts --to +1XXXXXXXXXX --approve  # places the call
 *   npx tsx scripts/vapi-test-call.ts --cleanup <caseId> --institution <id>  # deletes the synthetic rows
 *
 * Never prints secrets or the monitor listen URL. Synthetic data only.
 */
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const s = await import('../db/schema');
  const db = getDb();
  const cleanup = arg('--cleanup');
  if (cleanup) {
    await db.delete(s.cases).where(eq(s.cases.id, cleanup));
    const inst = arg('--institution');
    if (inst) await db.delete(s.institutions).where(eq(s.institutions.id, inst));
    console.log(`deleted case ${cleanup}${inst ? ` and institution ${inst}` : ''}`);
    return;
  }
  const to = arg('--to');
  const approve = process.argv.includes('--approve');
  const { parseAllowlist, normalizeAddress } = await import('../lib/safety/allowlist');
  const allow = parseAllowlist(process.env.OUTBOUND_ALLOWLIST ?? '');
  const target = to ? normalizeAddress(to) : undefined;
  if (!target || !allow.includes(target)) throw new Error('--to must be a phone number on OUTBOUND_ALLOWLIST');

  const { selectChannels, PostgresFollowUpStore, WiredOutreachService } = await import('../lib/outreach/channel-wiring');
  const { PostgresOutreachStore } = await import('../lib/outreach/postgres-store');
  const { workflowSendEvents } = await import('../lib/workflows/inline-events');
  const selected = selectChannels(process.env);
  if (selected.providers.voice !== 'vapi') throw new Error(`voice provider is ${selected.providers.voice}, expected vapi`);

  const [caseRow] = await db.insert(s.cases).values({
    diseaseName: 'Synthetic rare sarcoma (Wayfinder voice test)', homeCity: 'Houston', homeState: 'TX', status: 'confirmed',
  }).returning({ id: s.cases.id });
  const [inst] = await db.insert(s.institutions).values({ name: 'Wayfinder Test Line (synthetic clinic)', kind: 'rare_disease_center', city: 'Houston', state: 'TX' }).returning({ id: s.institutions.id });
  const [contact] = await db.insert(s.contacts).values({ caseId: caseRow!.id, targetKind: 'institution', targetId: inst!.id, channel: 'voice', address: target, state: 'drafted' }).returning({ id: s.contacts.id });
  console.log(`case ${caseRow!.id} institution ${inst!.id} contact ${contact!.id}`);

  const service = new WiredOutreachService(new PostgresOutreachStore(), selected.channels, workflowSendEvents(), process.env, () => new Date(), new PostgresFollowUpStore());
  await service.consent(contact!.id, ['diseaseName', 'homeState']);
  const draft = await service.draft(contact!.id);
  console.log('--- draft (the approved script) ---');
  console.log(draft.body);
  if (!approve) { console.log('dry run: pass --approve to place the call'); return; }
  const result = await service.approve(contact!.id, draft.id);
  const provider = 'provider' in result ? result.provider : {};
  console.log(`approved; provider=${(provider as { provider?: string }).provider ?? '?'} callId=${(provider as { callId?: string }).callId ?? '?'} status=${(provider as { status?: string }).status ?? '?'}`);
}

main().then(() => process.exit(0), err => {
  const msg = String((err as Error)?.message ?? err).replace(/postgres(ql)?:\/\/\S+/gi, '[redacted]').replace(/wss?:\/\/\S+/gi, '[url]');
  console.error(msg);
  process.exit(1);
});
