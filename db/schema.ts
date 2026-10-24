import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  vector,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const goalEnum = pgEnum("goal", [
  "second_opinion",
  "treatment",
  "trial",
  "support",
  "aid",
]);

export const institutionKindEnum = pgEnum("institution_kind", [
  "cancer_center",
  "rare_disease_center",
  "hospital",
]);

export const organizationKindEnum = pgEnum("organization_kind", [
  "advocacy",
  "financial_aid",
  "travel_aid",
]);

export const targetKindEnum = pgEnum("target_kind", [
  "expert",
  "institution",
  "trial",
  "organization",
]);

export const sourceKindEnum = pgEnum("source_kind", [
  "pubmed",
  "ctgov",
  "nppes",
  "nci",
  "exa",
]);

export const channelEnum = pgEnum("channel", ["email", "voice"]);

export const contactStateEnum = pgEnum("contact_state", [
  "drafted",
  "sent",
  "replied",
  "task_open",
  "records_sent",
  "appointment_booked",
  "connected",
  "declined",
  "stalled",
]);

export const taskKindEnum = pgEnum("task_kind", [
  "referral",
  "slides",
  "records",
  "call",
  "redirect",
  "unclear",
  "declined",
]);

export const taskStatusEnum = pgEnum("task_status", ["open", "approved", "done"]);

export const reviewVerdictEnum = pgEnum("review_verdict", ["correct", "incorrect"]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  "done",
  "failed",
  "not_implemented",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
};

export const cases = pgTable(
  "cases",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  diseaseName: text("disease_name").notNull(),
  diseaseCodes: jsonb("disease_codes").$type<{
    orpha?: string | null;
    mesh?: string | null;
    icd10?: string | null;
  }>(),
  subtype: text("subtype"),
  stageSummary: text("stage_summary"),
  homeCity: text("home_city"),
  homeState: text("home_state"),
  insurer: text("insurer"),
  planId: text("plan_id"),
  travelLimitMiles: integer("travel_limit_miles"),
  goals: goalEnum("goals")
    .array()
    .notNull()
    .default(sql`ARRAY[]::goal[]`),
  status: text("status").notNull().default("unconfirmed"),
  ownerSessionId: text("owner_session_id"),
  patientEmail: text("patient_email"),
  patientNotifyOptIn: boolean("patient_notify_opt_in").notNull().default(false),
  patientNotifyLastAt: timestamp("patient_notify_last_at", { withTimezone: true }),
  patientNotifyDigestOn: text("patient_notify_digest_on"),
  ...timestamps,
  },
  (table) => [index("cases_owner_session_id_idx").on(table.ownerSessionId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export const institutions = pgTable("institutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: institutionKindEnum("kind").notNull(),
  nciDesignated: boolean("nci_designated").notNull().default(false),
  programs: jsonb("programs").$type<Record<string, unknown>[]>(),
  intakeUrl: text("intake_url"),
  intakeContact: text("intake_contact"),
  city: text("city"),
  state: text("state"),
});

export const experts = pgTable(
  "experts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    npi: text("npi"),
    name: text("name").notNull(),
    credentials: text("credentials"),
    specialty: text("specialty"),
    institutionId: uuid("institution_id").references(() => institutions.id),
    diseasePaperCount: integer("disease_paper_count"),
    recentPaperCount: integer("recent_paper_count"),
    trialsLed: integer("trials_led"),
    verified: boolean("verified").notNull().default(false),
  },
  (table) => [uniqueIndex("experts_npi_unique").on(table.npi)],
);

export const trials = pgTable(
  "trials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nctId: text("nct_id").notNull(),
    title: text("title").notNull(),
    status: text("status"),
    phase: text("phase"),
    sponsor: text("sponsor"),
    sites: jsonb("sites").$type<Record<string, unknown>[]>(),
    contacts: jsonb("contacts").$type<Record<string, unknown>[]>(),
  },
  (table) => [uniqueIndex("trials_nct_id_unique").on(table.nctId)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: organizationKindEnum("kind").notNull(),
  name: text("name").notNull(),
  url: text("url"),
  services: jsonb("services").$type<Record<string, unknown>[]>(),
  contact: jsonb("contact").$type<Record<string, unknown>>(),
});

/**
 * Evidence is scoped to the case whose research produced it: the same resource (e.g. one NPI) can appear in many
 * cases, and one case must never read another case's evidence. `id` is the verifier's deterministic evidence id, so
 * the key is (case_id, id).
 */
export const evidence = pgTable("evidence", {
  id: uuid("id").notNull().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  targetKind: targetKindEnum("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  claimType: text("claim_type").notNull(),
  claim: text("claim").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceKind: sourceKindEnum("source_kind").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.caseId, table.id] })]);

export const caseCandidates = pgTable("case_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  targetKind: targetKindEnum("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  rank: integer("rank"),
  score: integer("score"),
  scoreBreakdown: jsonb("score_breakdown").$type<
    { factor: string; points: number; text: string; evidenceIds: string[] }[]
  >(),
  selected: boolean("selected").notNull().default(false),
  // Curator tier beside the deterministic rank (task #26); reasons cite evidence ids.
  tier: text("tier"),
  tierReasons: jsonb("tier_reasons").$type<{ text: string; evidenceIds: string[] }[]>(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  targetKind: targetKindEnum("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  channel: channelEnum("channel").notNull(),
  address: text("address").notNull(),
  state: contactStateEnum("state").notNull().default("drafted"),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  firstSentAt: timestamp("first_sent_at", { withTimezone: true }),
  followUpsSent: integer("follow_ups_sent").notNull().default(0),
});

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  sharedFields: text("shared_fields").array().notNull().default(sql`ARRAY[]::text[]`),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  direction: text("direction").notNull(),
  channel: channelEnum("channel").notNull(),
  providerThreadId: text("provider_thread_id"),
  providerMessageId: text("provider_message_id"),
  subject: text("subject"),
  body: text("body").notNull(),
  sharedFields: text("shared_fields").array().notNull().default(sql`ARRAY[]::text[]`),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  classification: text("classification"),
  approvalFingerprint: text("approval_fingerprint"),
});

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  providerCallId: text("provider_call_id"),
  toNumber: text("to_number").notNull(),
  script: text("script").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  transcript: text("transcript"),
  outcome: text("outcome"),
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    kind: taskKindEnum("kind").notNull(),
    draftBody: text("draft_body"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: taskStatusEnum("status").notNull().default("open"),
    title: text("title"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    caseId: uuid("case_id").references(() => cases.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [index("tasks_case_id_idx").on(table.caseId)],
);

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  targetKind: targetKindEnum("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  reviewer: text("reviewer").notNull(),
  verdict: reviewVerdictEnum("verdict").notNull(),
  note: text("note"),
});

export const agentRuns = pgTable("agent_runs", {
  tokensIn: integer("tokens_in").default(0).notNull(),
  tokensOut: integer("tokens_out").default(0).notNull(),
  cacheRead: integer("cache_read").default(0).notNull(),
  cacheCreation: integer("cache_creation").default(0).notNull(),
  costUsd: doublePrecision("cost_usd"),
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  agent: text("agent").notNull(),
  status: agentRunStatusEnum("status").notNull().default("queued"),
  counts: jsonb("counts").$type<Record<string, number>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
  outputSummary: text("output_summary"),
});


export const documentKindEnum = pgEnum("document_kind", [
  "intake_report", "case_summary", "resource_page", "evidence", "inbound_message", "call_transcript", "patient_note",
]);
export const caseDocuments = pgTable("case_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  kind: documentKindEnum("kind").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  sharedField: text("shared_field"),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  embedModel: text("embed_model").notNull(),
  ...timestamps,
}, table => [
  index("case_documents_scope_idx").on(table.caseId, table.contactId),
  index("case_documents_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
]);

/** One current contact plan per case (the full ContactPlan lives in `plan`; scalar columns support optimistic concurrency). */
export const contactPlans = pgTable("contact_plans", {
  caseId: uuid("case_id").primaryKey().references(() => cases.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  source: text("source").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});
