import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import * as s from "../../db/schema";
import { isAllowed, normalizeAddress } from "../safety/allowlist";
import {
  approvalFingerprint,
  assessPreapproved,
  canonicalFollowUp,
  type ApprovalContext,
  type CaseSnapshot,
  type FollowUpNumber,
  type OutreachChannel,
  type PreapprovedMessage,
} from "./preapprove";

export interface FollowUpPlanItem {
  messageId: string;
  contactId: string;
  classification: `follow_up_${FollowUpNumber}`;
  channel: OutreachChannel;
  body: string;
  subject: string | null;
  sharedFields: string[];
  approvedAt: string | null;
  sentAt: string | null;
  approvalFingerprint: string | null;
}
export interface NotificationSettings {
  patientEmail: string | null;
  optIn: boolean;
  homeState: string | null;
  lastSentAt: string | null;
  lastDigestOn: string | null;
}
export interface ContactPlanInput {
  contactId: string;
  caseId: string;
  channel: OutreachChannel;
  contactState: string;
  sharedFields: readonly string[];
  consentApprovedAt: string | null;
  snapshot: CaseSnapshot;
}
export interface FollowUpPlan {
  list(caseId: string): Promise<{ followUps: FollowUpPlanItem[]; notification: NotificationSettings }>;
  approve(input: ContactPlanInput & { approvedAt: Date }): Promise<FollowUpPlanItem[]>;
  revoke(contactId: string): Promise<{ revoked: number }>;
  cancelPending(contactId: string, reason: "reply" | "decline" | "revoke"): Promise<{ revoked: number }>;
  getMessage(contactId: string, followUpNumber: FollowUpNumber): Promise<PreapprovedMessage | null>;
  contextFor(contactId: string): Promise<ApprovalContext | null>;
  saveNotification(caseId: string, patch: { patientEmail: string | null; optIn: boolean }, policy: { mode: "dev" | "demo" | "prod"; allowlist: readonly string[]; outboundAllowReal?: string }): Promise<NotificationSettings>;
  recordNotify(caseId: string, sent: { lastSentAt: string; lastDigestOn: string | null }): Promise<void>;
}

export class MemoryFollowUpPlan implements FollowUpPlan {
  items: FollowUpPlanItem[] = [];
  contacts = new Map<string, ContactPlanInput>();
  notifications = new Map<string, NotificationSettings>();
  private seq = 0;
  async list(caseId: string) {
    const ids = new Set([...this.contacts.values()].filter((c) => c.caseId === caseId).map((c) => c.contactId));
    return {
      followUps: this.items.filter((i) => ids.has(i.contactId)),
      notification: this.notifications.get(caseId) ?? { patientEmail: null, optIn: false, homeState: null, lastSentAt: null, lastDigestOn: null },
    };
  }
  async approve(input: ContactPlanInput & { approvedAt: Date }) {
    this.contacts.set(input.contactId, input);
    if (!input.consentApprovedAt) throw new Error("Consent must be approved before follow-ups can be pre-approved");
    const fingerprint = approvalFingerprint(input.snapshot, input.sharedFields, input.consentApprovedAt);
    const approvedAt = input.approvedAt.toISOString();
    const made: FollowUpPlanItem[] = [];
    for (const n of [1, 2] as const) {
      const classification = `follow_up_${n}` as const;
      const canonical = canonicalFollowUp(input.channel);
      const existing = this.items.find((i) => i.contactId === input.contactId && i.classification === classification);
      if (existing?.sentAt) { made.push(existing); continue; }
      const row: FollowUpPlanItem = {
        messageId: existing?.messageId ?? `fu-${++this.seq}`,
        contactId: input.contactId, classification, channel: input.channel,
        body: canonical.body, subject: canonical.subject, sharedFields: [...input.sharedFields],
        approvedAt, sentAt: null, approvalFingerprint: fingerprint,
      };
      if (existing) Object.assign(existing, row); else this.items.push(row);
      made.push(existing ?? row);
    }
    return made;
  }
  async revoke(contactId: string) { return this.cancelPending(contactId, "revoke"); }
  async cancelPending(contactId: string, _reason: "reply" | "decline" | "revoke") {
    let revoked = 0;
    for (const item of this.items) {
      if (item.contactId === contactId && item.approvedAt && !item.sentAt) { item.approvedAt = null; revoked += 1; }
    }
    return { revoked };
  }
  async getMessage(contactId: string, followUpNumber: FollowUpNumber): Promise<PreapprovedMessage | null> {
    const item = this.items.find((i) => i.contactId === contactId && i.classification === `follow_up_${followUpNumber}`);
    return item ? { ...item, id: item.messageId } : null;
  }
  async contextFor(contactId: string): Promise<ApprovalContext | null> {
    const c = this.contacts.get(contactId);
    return c ? { snapshot: c.snapshot, sharedFields: c.sharedFields, consentApprovedAt: c.consentApprovedAt, contactState: c.contactState } : null;
  }
  async saveNotification(caseId: string, patch: { patientEmail: string | null; optIn: boolean }, policy: { mode: "dev" | "demo" | "prod"; allowlist: readonly string[]; outboundAllowReal?: string }) {
    const email = patch.patientEmail ? normalizeAddress(patch.patientEmail) : null;
    if (patch.patientEmail && !email) throw new Error("Invalid patient email");
    const enforce = !(policy.mode === "prod" && policy.outboundAllowReal === "true");
    if (patch.optIn && email && enforce && !isAllowed(email, policy.allowlist)) throw new Error("Patient email is not on OUTBOUND_ALLOWLIST");
    const prev = this.notifications.get(caseId);
    const next: NotificationSettings = { patientEmail: email, optIn: patch.optIn, homeState: prev?.homeState ?? null, lastSentAt: prev?.lastSentAt ?? null, lastDigestOn: prev?.lastDigestOn ?? null };
    this.notifications.set(caseId, next);
    return next;
  }
  async recordNotify(caseId: string, sent: { lastSentAt: string; lastDigestOn: string | null }) {
    const prev = this.notifications.get(caseId) ?? { patientEmail: null, optIn: false, homeState: null, lastSentAt: null, lastDigestOn: null };
    this.notifications.set(caseId, { ...prev, lastSentAt: sent.lastSentAt, lastDigestOn: sent.lastDigestOn });
  }
  setContext(contactId: string, patch: Partial<ContactPlanInput>) {
    const current = this.contacts.get(contactId);
    if (!current) throw new Error("unknown contact");
    this.contacts.set(contactId, { ...current, ...patch });
  }
}

function snapshotOf(row: typeof s.cases.$inferSelect): CaseSnapshot {
  return {
    diseaseName: row.diseaseName, diseaseCodes: row.diseaseCodes ?? null, subtype: row.subtype,
    stageSummary: row.stageSummary, homeCity: row.homeCity, homeState: row.homeState, insurer: row.insurer,
    planId: row.planId, travelLimitMiles: row.travelLimitMiles, goals: row.goals,
  };
}
function toItem(row: typeof s.messages.$inferSelect, classification: `follow_up_${FollowUpNumber}`): FollowUpPlanItem {
  return {
    messageId: row.id, contactId: row.contactId, classification, channel: row.channel, body: row.body,
    subject: row.subject, sharedFields: row.sharedFields, approvedAt: row.approvedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null, approvalFingerprint: row.approvalFingerprint,
  };
}
export class PostgresFollowUpPlan implements FollowUpPlan {
  private get db() { return getDb(); }
  async list(caseId: string) {
    const [caseRow] = await this.db.select().from(s.cases).where(eq(s.cases.id, caseId));
    if (!caseRow) throw new Error("Case not found");
    const contacts = await this.db.select().from(s.contacts).where(eq(s.contacts.caseId, caseId));
    const followUps: FollowUpPlanItem[] = [];
    for (const contact of contacts) {
      const rows = await this.db.select().from(s.messages).where(eq(s.messages.contactId, contact.id));
      for (const row of rows) {
        if (row.classification === "follow_up_1" || row.classification === "follow_up_2") followUps.push(toItem(row, row.classification));
      }
    }
    return { followUps, notification: { patientEmail: caseRow.patientEmail, optIn: caseRow.patientNotifyOptIn, homeState: caseRow.homeState, lastSentAt: caseRow.patientNotifyLastAt?.toISOString() ?? null, lastDigestOn: caseRow.patientNotifyDigestOn } };
  }
  async approve(input: ContactPlanInput & { approvedAt: Date }) {
    if (!input.consentApprovedAt) throw new Error("Consent must be approved before follow-ups can be pre-approved");
    const fingerprint = approvalFingerprint(input.snapshot, input.sharedFields, input.consentApprovedAt);
    const made: FollowUpPlanItem[] = [];
    for (const n of [1, 2] as const) {
      const classification = `follow_up_${n}` as const;
      const canonical = canonicalFollowUp(input.channel);
      const [existing] = await this.db.select().from(s.messages).where(and(eq(s.messages.contactId, input.contactId), eq(s.messages.classification, classification)));
      if (existing?.sentAt) { made.push(toItem(existing, classification)); continue; }
      const values = { contactId: input.contactId, direction: "outbound", channel: input.channel, subject: canonical.subject, body: canonical.body, sharedFields: [...input.sharedFields], approvedAt: input.approvedAt, sentAt: null, classification, approvalFingerprint: fingerprint };
      const [row] = existing ? await this.db.update(s.messages).set(values).where(eq(s.messages.id, existing.id)).returning() : await this.db.insert(s.messages).values(values).returning();
      made.push(toItem(row, classification));
    }
    return made;
  }
  async revoke(contactId: string) { return this.cancelPending(contactId, "revoke"); }
  async cancelPending(contactId: string, _reason: "reply" | "decline" | "revoke") {
    const rows = await this.db.select().from(s.messages).where(eq(s.messages.contactId, contactId));
    let revoked = 0;
    for (const row of rows) {
      if (!row.classification?.startsWith("follow_up_") || !row.approvedAt || row.sentAt) continue;
      await this.db.update(s.messages).set({ approvedAt: null }).where(eq(s.messages.id, row.id));
      revoked += 1;
    }
    return { revoked };
  }
  async getMessage(contactId: string, followUpNumber: FollowUpNumber): Promise<PreapprovedMessage | null> {
    const classification = `follow_up_${followUpNumber}` as const;
    const [row] = await this.db.select().from(s.messages).where(and(eq(s.messages.contactId, contactId), eq(s.messages.classification, classification)));
    if (!row) return null;
    const item = toItem(row, classification);
    return { ...item, id: item.messageId };
  }
  async contextFor(contactId: string): Promise<ApprovalContext | null> {
    const [contact] = await this.db.select().from(s.contacts).where(eq(s.contacts.id, contactId));
    if (!contact) return null;
    const [caseRow] = await this.db.select().from(s.cases).where(eq(s.cases.id, contact.caseId));
    const [consent] = await this.db.select().from(s.consents).where(eq(s.consents.contactId, contactId));
    if (!caseRow || !consent) return null;
    return { snapshot: snapshotOf(caseRow), sharedFields: consent.sharedFields, consentApprovedAt: consent.approvedAt?.toISOString() ?? null, contactState: contact.state };
  }
  async saveNotification(caseId: string, patch: { patientEmail: string | null; optIn: boolean }, policy: { mode: "dev" | "demo" | "prod"; allowlist: readonly string[]; outboundAllowReal?: string }) {
    const email = patch.patientEmail ? normalizeAddress(patch.patientEmail) : null;
    if (patch.patientEmail && !email) throw new Error("Invalid patient email");
    const enforce = !(policy.mode === "prod" && policy.outboundAllowReal === "true");
    if (patch.optIn && email && enforce && !isAllowed(email, policy.allowlist)) throw new Error("Patient email is not on OUTBOUND_ALLOWLIST");
    const [row] = await this.db.update(s.cases).set({ patientEmail: email, patientNotifyOptIn: patch.optIn }).where(eq(s.cases.id, caseId)).returning();
    if (!row) throw new Error("Case not found");
    return { patientEmail: row.patientEmail, optIn: row.patientNotifyOptIn, homeState: row.homeState, lastSentAt: row.patientNotifyLastAt?.toISOString() ?? null, lastDigestOn: row.patientNotifyDigestOn };
  }
  async recordNotify(caseId: string, sent: { lastSentAt: string; lastDigestOn: string | null }) {
    await this.db.update(s.cases).set({ patientNotifyLastAt: new Date(sent.lastSentAt), patientNotifyDigestOn: sent.lastDigestOn }).where(eq(s.cases.id, caseId));
  }
}
let active: FollowUpPlan | null = null;
export function setFollowUpPlanForTests(plan: FollowUpPlan | null) { active = plan; }
export function getFollowUpPlan(): FollowUpPlan { return active ?? new PostgresFollowUpPlan(); }
export async function resolvePreapprovedSend(plan: FollowUpPlan, input: { contactId: string; followUpNumber: FollowUpNumber }): Promise<{ action: "send"; messageId: string; body: string } | { action: "hold"; reason: string }> {
  const row = await plan.getMessage(input.contactId, input.followUpNumber);
  if (!row || !row.approvedAt) return { action: "hold", reason: "not_preapproved" };
  const current = await plan.contextFor(input.contactId);
  if (!current) return { action: "hold", reason: "missing_context" };
  if (current.contactState === "replied" || current.contactState === "declined") {
    await plan.cancelPending(input.contactId, current.contactState === "declined" ? "decline" : "reply");
    return { action: "hold", reason: current.contactState };
  }
  const decision = assessPreapproved(row, current);
  if (!decision.ok) return { action: "hold", reason: decision.reason };
  return { action: "send", messageId: row.id, body: decision.body };
}
