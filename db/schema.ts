import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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

export const cases = pgTable("cases", {
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
  ...timestamps,
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

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetKind: targetKindEnum("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  claimType: text("claim_type").notNull(),
  claim: text("claim").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceKind: sourceKindEnum("source_kind").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

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

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  kind: taskKindEnum("kind").notNull(),
  draftBody: text("draft_body"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: taskStatusEnum("status").notNull().default("open"),
});

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
