import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import type { PacketSectionKey, SpecialistPacket } from '../contract';
import { specialistPacketSchema } from '../contract';
import type { PacketDeps } from './deps';
import { MAX_PATIENT_QUESTIONS, buildSections, cleanPatientQuestion, patientQuestionsOf } from './extract';
import { includedSections, renderPacketText } from './render';

export type Result<T> = { ok: true; value: T } | { ok: false; status: 404 | 409 | 422; error: string };
const fail = (status: 404 | 409 | 422, error: string): Result<never> => ({ ok: false, status, error });

export const PACKET_BEGIN = '--- Patient-prepared packet (begin) ---';
export const PACKET_END = '--- Patient-prepared packet (end) ---';

/** Build (or rebuild) the packet for one selected resource. Rebuilding keeps the previous ticks and patient questions. */
export async function buildPacket(caseId: string, resourceKey: string, deps: PacketDeps): Promise<Result<SpecialistPacket>> {
  const inputs = await deps.inputs(caseId);
  const resource = inputs.find(i => `${i.targetKind}:${i.targetId}` === resourceKey);
  if (!resource) return fail(404, 'That resource is not one of your selected resources');
  const [docs, historyConflicts, checklist, existing] = await Promise.all([
    deps.history.load(caseId),
    deps.history.conflicts?.(caseId) ?? Promise.resolve([]),
    deps.store.get(caseId, 'checklist', resourceKey),
    deps.store.get(caseId, 'packet', resourceKey),
  ]);
  const prevIncluded = existing ? Object.fromEntries(existing.sections.map(s => [s.key, s.included])) as Partial<Record<PacketSectionKey, boolean>> : undefined;
  const sections = buildSections({
    name: resource.name,
    claims: resource.evidence.map(e => e.claim),
    docs,
    historyConflicts,
    requirements: checklist?.requirements ?? [],
    patientQuestions: existing ? patientQuestionsOf(existing.sections) : [],
  }, prevIncluded);
  const nowIso = deps.now().toISOString();
  const packet: SpecialistPacket = specialistPacketSchema.parse({
    id: existing?.id ?? crypto.randomUUID(), caseId, resourceKey, name: resource.name.slice(0, 200), sections,
    historySource: deps.history.name, version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? nowIso, updatedAt: nowIso,
  });
  const saved = await deps.store.save(caseId, 'packet', resourceKey, packet, existing?.version);
  return saved ? { ok: true, value: saved } : fail(409, 'The packet changed; reload and try again');
}

export interface PacketPatch {
  version: number;
  included?: Partial<Record<PacketSectionKey, boolean>>;
  questions?: string[];
}

export async function patchPacket(caseId: string, resourceKey: string, patch: PacketPatch, deps: PacketDeps): Promise<Result<SpecialistPacket>> {
  const current = await deps.store.get(caseId, 'packet', resourceKey);
  if (!current) return fail(404, 'No packet yet for that resource');
  if (current.version !== patch.version) return fail(409, 'The packet changed; reload and try again');
  const keep = patch.questions === undefined ? patientQuestionsOf(current.sections) : patch.questions.map(cleanPatientQuestion).filter(Boolean).slice(0, MAX_PATIENT_QUESTIONS);
  const rebuilt = buildSections({ name: current.name, claims: [], docs: [], requirements: [], patientQuestions: keep });
  const sections = current.sections.map(s => {
    const next = s.key === 'questions' ? { ...s, items: rebuilt.find(r => r.key === 'questions')!.items } : s;
    const tick = patch.included?.[s.key];
    return tick === undefined ? next : { ...next, included: tick };
  });
  const updated: SpecialistPacket = { ...current, sections, version: current.version + 1, updatedAt: deps.now().toISOString() };
  const saved = await deps.store.save(caseId, 'packet', resourceKey, updated, current.version);
  return saved ? { ok: true, value: saved } : fail(409, 'The packet changed; reload and try again');
}

export async function packetText(caseId: string, resourceKey: string, deps: PacketDeps): Promise<Result<string>> {
  const packet = await deps.store.get(caseId, 'packet', resourceKey);
  return packet ? { ok: true, value: renderPacketText(packet) } : fail(404, 'No packet yet for that resource');
}

/** Insert (or replace) the packet block in a draft body, ahead of the AI disclosure footer when present. */
export function withPacketBlock(body: string, text: string): string {
  const block = `${PACKET_BEGIN}\n${text}\n${PACKET_END}`;
  const begin = body.indexOf(PACKET_BEGIN);
  const end = body.indexOf(PACKET_END);
  if (begin !== -1 && end > begin) return `${body.slice(0, begin)}${block}${body.slice(end + PACKET_END.length)}`;
  const footer = body.indexOf(AI_DISCLOSURE_EMAIL);
  if (footer !== -1) return `${body.slice(0, footer).trimEnd()}\n\n${block}\n\n${body.slice(footer)}`;
  return `${body.trimEnd()}\n\n${block}`;
}

/**
 * Append the included packet sections to the contact's pending, unapproved outreach draft. The draft is then reviewed in
 * the outbox and still passes checkOutbound at approval; nothing is sent here.
 */
export async function attachPacket(caseId: string, resourceKey: string, contactId: string, deps: PacketDeps): Promise<Result<{ draftId: string }>> {
  const packet = await deps.store.get(caseId, 'packet', resourceKey);
  if (!packet) return fail(404, 'No packet yet for that resource');
  if (includedSections(packet).length === 0) return fail(422, 'Tick at least one packet section with content before attaching');
  const contact = await deps.outreach.contact(contactId);
  if (!contact || contact.caseId !== caseId) return fail(404, 'Contact not found');
  if (`${contact.targetKind}:${contact.targetId}` !== resourceKey) return fail(422, 'That contact is not for this resource');
  if (contact.channel !== 'email') return fail(422, 'Packets can only be attached to email drafts');
  const consent = await deps.outreach.consent(contactId);
  const draft = consent?.approvedAt && deps.outreach.pendingDraft ? await deps.outreach.pendingDraft(contact, consent.sharedFields) : undefined;
  if (!draft || draft.approvedAt || draft.sentAt) return fail(409, 'There is no pending draft to attach to (it may already be approved or sent)');
  if (!deps.outreach.updateDraftBody) return fail(409, 'This outreach store cannot update drafts');
  const ok = await deps.outreach.updateDraftBody(draft.id, contactId, withPacketBlock(draft.body, renderPacketText(packet)));
  return ok ? { ok: true, value: { draftId: draft.id } } : fail(409, 'The draft was approved or changed; open the outbox');
}
