import { sql } from "drizzle-orm";
import {
  bigint,
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
  "registry",
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
  "phone_call",
]);

/** "web": a resource reachable only through an online form (address = form URL). It never gets an email or call draft. */
export const channelEnum = pgEnum("channel", ["email", "voice", "web"]);

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
  "application",
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
    omim?: string | null;
  }>(),
  subtype: text("subtype"),
  stageSummary: text("stage_summary"),
  homeCity: text("home_city"),
  homeState: text("home_state"),
  insurer: text("insurer"),
  planId: text("plan_id"),
  travelLimitMiles: integer("travel_limit_miles"),
  /** The patient has no diagnosis yet (diagnostic odyssey path); diseaseName then holds a fixed label. */
  undiagnosed: boolean("undiagnosed").notNull().default(false),
  /** Patient's own words about their symptoms (undiagnosed path); quoted back with a citation, never interpreted. */
  symptomNotes: text("symptom_notes"),
  goals: goalEnum("goals")
    .array()
    .notNull()
    .default(sql`ARRAY[]::goal[]`),
  status: text("status").notNull().default("unconfirmed"),
  ownerSessionId: text("owner_session_id"),
  /** Neon Auth user id of the signed-in account that owns this case (null for anonymous cases). */
  accountId: text("account_id"),
  patientEmail: text("patient_email"),
  patientNotifyOptIn: boolean("patient_notify_opt_in").notNull().default(false),
  patientNotifyLastAt: timestamp("patient_notify_last_at", { withTimezone: true }),
  patientNotifyDigestOn: text("patient_notify_digest_on"),
  ...timestamps,
  },
  (table) => [index("cases_owner_session_id_idx").on(table.ownerSessionId), index("cases_account_id_idx").on(table.accountId)],
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
    .references(() => cases.id, { onDelete: "cascade" }),
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
    .references(() => cases.id, { onDelete: "cascade" }),
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
    .references(() => cases.id, { onDelete: "cascade" }),
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
    .references(() => contacts.id, { onDelete: "cascade" }),
  sharedFields: text("shared_fields").array().notNull().default(sql`ARRAY[]::text[]`),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  channel: channelEnum("channel").notNull().$type<"email" | "voice">(), // messages are only ever email or a call script
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
  /** Inbound only: set once classification -> tasks and the reply event both succeeded (webhook ingest ledger). */
  ingestedAt: timestamp("ingested_at", { withTimezone: true }),
  /** Inbound only: lease held by the webhook request currently ingesting this message. */
  ingestClaimedAt: timestamp("ingest_claimed_at", { withTimezone: true }),
});

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  providerCallId: text("provider_call_id"),
  toNumber: text("to_number").notNull(),
  script: text("script").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  transcript: text("transcript"),
  outcome: text("outcome"),
  /** Set once the transcript was ingested (tasks + reply event); see the webhook ingest ledger. */
  transcriptIngestedAt: timestamp("transcript_ingested_at", { withTimezone: true }),
  transcriptIngestClaimedAt: timestamp("transcript_ingest_claimed_at", { withTimezone: true }),
});

/** Live provider state of a call (Vapi): status, end reason, summary and the listen-only monitor URL (judge view only). */
export const callLive = pgTable("call_live", {
  callId: uuid("call_id").primaryKey().references(() => calls.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  status: text("status"),
  endedReason: text("ended_reason"),
  summary: text("summary"),
  /** Vapi monitor.listenUrl. A bearer-like secret for live audio: never logged, returned only to the judge view. */
  listenUrl: text("listen_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Live transcript: one row per final utterance, stored as it arrives (untrusted callee speech, rendered as text). */
export const callTurns = pgTable("call_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  seq: bigint("seq", { mode: "number" }).notNull(),
  role: text("role").notNull(),
  text: text("text").notNull(),
  spokenAt: timestamp("spoken_at", { withTimezone: true }),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("call_turns_call_seq_idx").on(table.callId, table.seq)]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: taskKindEnum("kind").notNull(),
    draftBody: text("draft_body"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: taskStatusEnum("status").notNull().default("open"),
    title: text("title"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Inbound event that produced the task ("email:<provider message id>" / "voice:<call id>"). */
    sourceId: text("source_id"),
  },
  (table) => [index("tasks_case_id_idx").on(table.caseId), index("tasks_source_id_idx").on(table.sourceId)],
);

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id, { onDelete: "cascade" }),
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
    .references(() => cases.id, { onDelete: "cascade" }),
  agent: text("agent").notNull(),
  status: agentRunStatusEnum("status").notNull().default("queued"),
  counts: jsonb("counts").$type<Record<string, number>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
  outputSummary: text("output_summary"),
});


export const documentKindEnum = pgEnum("document_kind", [
  "intake_report", "case_summary", "resource_page", "evidence", "inbound_message", "call_transcript", "patient_note", "medical_record",
]);
export const caseDocuments = pgTable("case_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
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

/** Drafts of online application forms filled by the web_form channel (task #58). Nothing is submitted without approved_at. */
export const webApplications = pgTable("web_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  fields: jsonb("fields").$type<unknown[]>().notNull(),
  missing: jsonb("missing").$type<unknown[]>().notNull(),
  formFingerprint: text("form_fingerprint").notNull(),
  screenshot: text("screenshot"),
  sharedFields: text("shared_fields").array().notNull().default(sql`ARRAY[]::text[]`),
  sharedDocIds: text("shared_doc_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  status: text("status").notNull().default("draft"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  result: jsonb("result").$type<Record<string, unknown>>(),
  /** The patient's answers to this form's own questions (fieldKey -> {value, origin}); consent for this row only. */
  answers: jsonb("answers").$type<Record<string, { value: string; origin: string }>>().notNull().default({}),
  ...timestamps,
}, (table) => [index("web_applications_case_idx").on(table.caseId)]);

/** Medical history lane: patient-uploaded records (sanitized text) with their extracted timeline events. */
export const historyDocuments = pgTable("history_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  docType: text("doc_type").notNull(),
  text: text("text").notNull(),
  extractedBy: text("extracted_by").notNull(),
  events: jsonb("events").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  /** Account library document this copy came from (drizzle/0047). Cascade: deleting the library doc removes the copy. */
  sourceDocumentId: uuid("source_document_id").references(() => accountDocuments.id, { onDelete: "cascade" }),
  ...timestamps,
}, table => [
  index("history_documents_case_idx").on(table.caseId),
  index("history_documents_source_document_idx").on(table.sourceDocumentId),
]);

/** Revocable, expiring share links for the medical history summary. The token is HMAC-signed; only the id is stored. */
export const historyShares = pgTable("history_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  sections: text("sections").array().notNull(),
  label: text("label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
}, table => [index("history_shares_case_idx").on(table.caseId)]);

// ---- research-to-care (rd-experts lane): expert_traces ----
/** One row per tracer run; the full ExpertTrace (chains + code-stamped evidence) lives in `trace`. Latest by traced_at wins. */
export const expertTraces = pgTable("expert_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  tracedAt: timestamp("traced_at", { withTimezone: true }).notNull().defaultNow(),
  trace: jsonb("trace").$type<Record<string, unknown>>().notNull(),
}, (table) => [index("expert_traces_case_idx").on(table.caseId)]);
// ---- end research-to-care ----

// --- rd-experts: verification calls (lib/verification) ---
/** AI verification calls (six fixed questions). Nothing is dialed until approved_at is set and checkOutbound passes. */
export const verificationRequests = pgTable("verification_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  resourceKey: text("resource_key").notNull(),
  targetKind: targetKindEnum("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  phoneEvidenceId: text("phone_evidence_id").notNull(),
  sharedFields: jsonb("shared_fields").$type<string[]>().notNull(),
  script: text("script").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  callId: text("call_id"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  blockedReasons: jsonb("blocked_reasons").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
}, (table) => [
  index("verification_requests_case_idx").on(table.caseId),
  uniqueIndex("verification_requests_call_id_unique").on(table.callId),
]);
// --- end rd-experts: verification calls ---

/** Rare-disease coordination records (referral checklists, specialist packets, doctors, consult requests). */
export const coordinationRecords = pgTable("coordination_records", {
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  key: text("key").notNull(),
  version: integer("version").notNull().default(1),
  /** sha256 of a consult request's signed review token (never the token itself). */
  tokenHash: text("token_hash"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.caseId, table.kind, table.key] }),
  uniqueIndex("coordination_records_token_hash_idx").on(table.tokenHash),
]);

// Needs analyst cache: disease-level CareNeeds keyed by normalized disease (+ subtype). Deliberately NOT tied to a
// case (no case_id, no personal fields), so it outlives any single case; expires_at enforces the TTL.
export const needsCache = pgTable("needs_cache", {
  cacheKey: text("cache_key").primaryKey(),
  diseaseName: text("disease_name").notNull(),
  subtype: text("subtype"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("needs_cache_expires_idx").on(table.expiresAt)]);

// rd-research lane: one current Condition Brief per case (full ConditionBrief in `brief`, validated on read/write).
export const conditionBriefs = pgTable("condition_briefs", {
  caseId: uuid("case_id").primaryKey().references(() => cases.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  brief: jsonb("brief").$type<Record<string, unknown>>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- accounts lane: profile + medical-document library (account_id = Neon Auth user id) ----
export const accountProfiles = pgTable("account_profiles", {
  accountId: text("account_id").primaryKey(),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accountDocuments = pgTable("account_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  title: text("title").notNull(),
  docType: text("doc_type").notNull(),
  dateOfService: text("date_of_service"),
  provider: text("provider"),
  notes: text("notes"),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  blobPathname: text("blob_pathname").notNull(),
  status: text("status").notNull().default("pending_upload"),
  statusDetail: text("status_detail"),
  pageCount: integer("page_count"),
  chunkCount: integer("chunk_count").notNull().default(0),
  /** Sanitized extracted text (untrusted data). Never logged. */
  text: text("text"),
  /** Lane K: the patient lets resource-facing agents (agent factory) read this document. Default off (drizzle/0052). */
  shareWithResources: boolean("share_with_resources").notNull().default(false),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index("account_documents_account_idx").on(table.accountId, table.createdAt),
  uniqueIndex("account_documents_blob_pathname_key").on(table.blobPathname),
]);

export const accountDocumentChunks = pgTable("account_document_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  documentId: uuid("document_id").notNull().references(() => accountDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  page: integer("page"),
  section: text("section"),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  embedModel: text("embed_model").notNull(),
  ...timestamps,
}, table => [
  index("account_document_chunks_scope_idx").on(table.accountId, table.embedModel),
  index("account_document_chunks_document_idx").on(table.documentId),
  index("account_document_chunks_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
]);

/** Lane K: which documents each agent read for a case ("Used 2 of your documents" in the judge view). Titles only. */
export const documentUses = pgTable("document_uses", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  agent: text("agent").notNull(),
  documentId: uuid("document_id").notNull(),
  title: text("title").notNull(),
  ...timestamps,
}, table => [
  index("document_uses_case_idx").on(table.caseId, table.createdAt),
  uniqueIndex("document_uses_case_agent_doc_key").on(table.caseId, table.agent, table.documentId),
]);

// ---- calendar lane: appointments, calendar feeds, calendar connections ----
/**
 * Appointments, consults, screening interviews and the like. A row captured from a reply starts as `proposed`
 * (candidate times in `candidates`) and only the patient confirms it; nothing is ever auto-confirmed or sent.
 */
export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  /** Viewer key of the case owner when the row was written (session id today, account id later). */
  ownerKey: text("owner_key"),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  timezone: text("timezone").notNull(),
  location: text("location"),
  telehealthUrl: text("telehealth_url"),
  phone: text("phone"),
  withWhom: text("with_whom"),
  status: text("status").notNull(),
  source: text("source").notNull(),
  sourceMessageId: text("source_message_id"),
  /** Candidate slots for a proposed appointment, each { startsAt, endsAt, text, weekdayMismatch }. */
  candidates: jsonb("candidates").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  /** Verbatim (sanitized) snippet of the reply that proposed the time. */
  quote: text("quote"),
  /** Patient-written prep: checklist state and their own questions. Never generated advice. */
  prepNotes: jsonb("prep_notes").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** Reminder offsets in minutes before the start (default 1 day and 2 hours). */
  reminders: jsonb("reminders").$type<number[]>().notNull().default(sql`'[1440,120]'::jsonb`),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  googleEventId: text("google_event_id"),
  /** Outbound reschedule/cancel request draft (messages.id), when one is pending. */
  requestMessageId: uuid("request_message_id"),
  sequence: integer("sequence").notNull().default(0),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("appointments_case_idx").on(table.caseId),
  index("appointments_owner_idx").on(table.ownerKey),
  uniqueIndex("appointments_source_unique").on(table.caseId, table.sourceMessageId),
]);

/** Private ICS subscription feeds. The URL token is HMAC-signed over the id; revoking sets revoked_at. */
export const calendarFeeds = pgTable("calendar_feeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerKey: text("owner_key").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("calendar_feeds_owner_idx").on(table.ownerKey)]);

/** Google Calendar OAuth connection per viewer. Tokens are AES-256-GCM sealed with WAYFINDER_TOKEN_KEY. */
export const calendarConnections = pgTable("calendar_connections", {
  ownerKey: text("owner_key").notNull(),
  provider: text("provider").notNull(),
  scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
  refreshTokenSealed: text("refresh_token_sealed"),
  accessTokenSealed: text("access_token_sealed"),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  calendarId: text("calendar_id").notNull().default("primary"),
  freeBusyOptIn: boolean("free_busy_opt_in").notNull().default(false),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.ownerKey, table.provider] })]);
// ---- end calendar lane ----

// ---- agent factory lane: one persistent ResourceAgent per selected resource ----
/** A self-managing agent for one resource. Owns its channels (inbox, calls, web applications), memory and events. */
export const resourceAgents = pgTable("resource_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  /** `${targetKind}:${targetId}`; one agent per resource per case (spawn is idempotent on this). */
  resourceKey: text("resource_key").notNull(),
  name: text("name").notNull(),
  goal: text("goal").notNull(),
  strategy: jsonb("strategy").$type<string[]>().notNull(),
  strategyStep: integer("strategy_step").notNull().default(0),
  state: text("state").notNull().default("planning"),
  nextAction: text("next_action"),
  nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  memory: jsonb("memory").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  inboxMode: text("inbox_mode").notNull().default("pending"),
  inboxId: text("inbox_id"),
  inboxAddress: text("inbox_address"),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("resource_agents_case_resource_key").on(table.caseId, table.resourceKey),
  uniqueIndex("resource_agents_contact_key").on(table.contactId),
  index("resource_agents_due_idx").on(table.nextActionAt),
  index("resource_agents_inbox_idx").on(table.inboxId),
]);

/** One row per agent decision (reason, action, result) for the live console and the judge view. */
export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => resourceAgents.id, { onDelete: "cascade" }),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  trigger: text("trigger"),
  reason: text("reason"),
  action: text("action"),
  result: text("result"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_events_case_idx").on(table.caseId, table.createdAt),
  index("agent_events_agent_idx").on(table.agentId, table.createdAt),
]);
/** Chat with one agent (app or patient email reply), plus queued patient updates (role 'agent', data.notify). */
export const agentMessages = pgTable("agent_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => resourceAgents.id, { onDelete: "cascade" }),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  body: text("body").notNull(),
  via: text("via").notNull().default("app"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_messages_agent_idx").on(table.agentId, table.createdAt),
  index("agent_messages_case_idx").on(table.caseId, table.createdAt),
]);

/** Single-use ledger for approve-by-email tokens (jti). A replayed token finds its row and is refused. */
export const agentApprovalTokens = pgTable("agent_approval_tokens", {
  jti: text("jti").primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => resourceAgents.id, { onDelete: "cascade" }),
  draftId: uuid("draft_id").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
});
// ---- end agent factory lane ----
