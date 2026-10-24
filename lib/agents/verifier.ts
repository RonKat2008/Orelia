import { createHash } from "node:crypto";
import type { Evidence, ResearchResult, Resource } from "@/lib/contracts";

/**
 * Verifier (HARD RULE 2): deterministic code, no model in the trust path.
 *  - drops every evidence item without a usable http(s) sourceUrl
 *  - drops every record left with zero evidence
 *  - merges duplicates (expert by NPI, trial by nctId, org by URL host+path, institution by name)
 *  - flags conflicts for a human/UI to see
 * An optional proposer (an Opus pass, off by default and never run offline) may only
 * propose merges between records that already exist and extra conflict notes. It cannot add claims.
 */

export type EvidenceWithId = Evidence & { id: string };

export interface VerifiedRecord {
  /** Canonical record; `id` is a deterministic UUID derived from the dedupe key. */
  resource: Resource;
  /** Dedupe key, e.g. "expert:npi:1234567890". */
  key: string;
  evidence: EvidenceWithId[];
}

export interface DroppedItem {
  /** What was dropped: a whole record, or a single evidence item. */
  type: "record" | "evidence";
  record: unknown;
  reason: string;
}

export interface MergeInfo {
  key: string;
  keptId: string;
  mergedFromIds: string[];
}

export interface ConflictInfo {
  key: string;
  recordId: string;
  reason: string;
  values: string[];
}

export interface VerifyOutput {
  kept: VerifiedRecord[];
  dropped: DroppedItem[];
  merged: MergeInfo[];
  conflicts: ConflictInfo[];
}

export interface MergeProposal {
  /** Keys of two existing kept records (same kind) the model thinks are the same entity. */
  keys: [string, string];
  reason: string;
}

export interface VerifyProposals {
  merges: MergeProposal[];
  conflicts: { key: string; reason: string }[];
}

export type Proposer = (kept: readonly VerifiedRecord[]) => Promise<VerifyProposals>;

// ---------- normalisation ----------

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|of|inc|llc|md|do|phd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function isUsableUrl(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && normalizeUrl(value.trim()) !== null;
}

function hashHex(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

/** Deterministic UUID-shaped id so DB rows, evidence ids and score breakdown refs line up. */
export function deterministicUuid(input: string): string {
  const h = hashHex(input);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function dedupeKey(r: Resource): string {
  switch (r.kind) {
    case "expert":
      return r.npi ? `expert:npi:${r.npi.trim()}` : `expert:name:${normalizeName(r.name)}`;
    case "trial":
      return `trial:nct:${r.nctId.trim().toUpperCase()}`;
    case "organization": {
      const u = r.url ? normalizeUrl(r.url) : null;
      return u ? `organization:url:${u}` : `organization:name:${normalizeName(r.name)}`;
    }
    case "institution":
      return `institution:name:${normalizeName(r.name)}`;
  }
}

// ---------- evidence resolution ----------

interface IndexedResult {
  records: Resource[];
  evidence: unknown[];
}

/**
 * evidenceRefs on a Resource may be an index into the result's evidence array ("0"),
 * the evidence sourceUrl, or an evidence id. Anything else resolves to nothing.
 */
function resolveRefs(refs: string[], evidence: (Evidence | null)[]): Evidence[] {
  const out = new Map<number, Evidence>();
  for (const ref of refs) {
    const idx = /^\d+$/.test(ref) ? Number(ref) : -1;
    if (idx >= 0 && evidence[idx]) {
      out.set(idx, evidence[idx]);
      continue;
    }
    evidence.forEach((e, i) => {
      if (e && (e.sourceUrl === ref || (e as Partial<EvidenceWithId>).id === ref)) out.set(i, e);
    });
  }
  return [...out.values()];
}

function cleanEvidence(raw: unknown, dropped: DroppedItem[]): Evidence | null {
  const e = raw as Partial<Evidence> | null;
  if (!e || typeof e !== "object") {
    dropped.push({ type: "evidence", record: raw, reason: "malformed evidence" });
    return null;
  }
  if (!isUsableUrl(e.sourceUrl)) {
    dropped.push({ type: "evidence", record: raw, reason: "missing or invalid sourceUrl" });
    return null;
  }
  if (typeof e.claim !== "string" || e.claim.trim() === "") {
    dropped.push({ type: "evidence", record: raw, reason: "empty claim" });
    return null;
  }
  return e as Evidence;
}

// ---------- merge ----------

function firstDefined<T>(a: T | undefined | null, b: T | undefined | null): T | undefined {
  const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
  if (!isEmpty(a)) return a as T;
  return isEmpty(b) ? undefined : (b as T);
}

function mergeResources(a: Resource, b: Resource): Resource {
  const merged: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === "evidenceRefs" || k === "id" || k === "kind") continue;
    merged[k] = firstDefined(merged[k], v as unknown);
  }
  return merged as Resource;
}

function conflictFor(a: Resource, b: Resource, key: string): string | null {
  if (a.kind === "expert" && b.kind === "expert" && key.startsWith("expert:npi:")) {
    if (normalizeName(a.name) !== normalizeName(b.name)) {
      return `NPI ${a.npi} reported under different names: "${a.name}" vs "${b.name}"`;
    }
  }
  if (a.kind === "trial" && b.kind === "trial") {
    if (normalizeName(a.title) !== normalizeName(b.title)) {
      return `${a.nctId} reported with different titles: "${a.title}" vs "${b.title}"`;
    }
    if (a.status && b.status && a.status !== b.status) {
      return `${a.nctId} reported with different statuses: "${a.status}" vs "${b.status}"`;
    }
  }
  if (a.kind === "organization" && b.kind === "organization" && key.includes(":url:")) {
    if (normalizeName(a.name) !== normalizeName(b.name)) {
      return `URL shared by different organizations: "${a.name}" vs "${b.name}"`;
    }
  }
  if (a.kind === "institution" && b.kind === "institution") {
    if (a.state && b.state && a.state.toUpperCase() !== b.state.toUpperCase()) {
      return `"${a.name}" reported in different states: ${a.state} vs ${b.state}`;
    }
  }
  return null;
}

interface Working {
  key: string;
  resource: Resource;
  originalIds: string[];
  evidence: Map<string, Evidence>;
}

function evidenceKey(e: Evidence): string {
  return `${e.sourceUrl}|${e.claimType}|${e.claim}`;
}

/** Deterministic verification. Pure: same input, same output. */
export function verify(results: readonly ResearchResult[]): VerifyOutput {
  const dropped: DroppedItem[] = [];
  const conflicts: ConflictInfo[] = [];
  const working = new Map<string, Working>();

  for (const result of results) {
    if (result.status !== "ok") continue;
    const view: IndexedResult = { records: result.records, evidence: result.evidence };
    const cleaned = view.evidence.map((e) => cleanEvidence(e, dropped));

    for (const record of view.records) {
      const refs = Array.isArray(record.evidenceRefs) ? record.evidenceRefs : [];
      const ev = resolveRefs(refs, cleaned);
      if (ev.length === 0) {
        dropped.push({ type: "record", record, reason: "no evidence with a sourceUrl" });
        continue;
      }
      const key = dedupeKey(record);
      const existing = working.get(key);
      if (!existing) {
        working.set(key, {
          key,
          resource: record,
          originalIds: [record.id],
          evidence: new Map(ev.map((e) => [evidenceKey(e), e])),
        });
        continue;
      }
      const reason = conflictFor(existing.resource, record, key);
      if (reason) {
        conflicts.push({
          key,
          recordId: existing.resource.id,
          reason,
          values: [existing.resource, record].map((r) => ("name" in r ? r.name : r.title)),
        });
      }
      existing.resource = mergeResources(existing.resource, record);
      existing.originalIds.push(record.id);
      for (const e of ev) existing.evidence.set(evidenceKey(e), e);
    }
  }

  return finalize([...working.values()], dropped, conflicts);
}

function finalize(items: Working[], dropped: DroppedItem[], conflicts: ConflictInfo[]): VerifyOutput {
  const idMap = new Map<string, string>();
  for (const w of items) {
    const canonical = deterministicUuid(w.key);
    for (const oid of w.originalIds) idMap.set(`${w.resource.kind}:${oid}`, canonical);
  }

  const merged: MergeInfo[] = [];
  const kept: VerifiedRecord[] = items.map((w) => {
    const id = deterministicUuid(w.key);
    let resource: Resource = { ...w.resource, id };
    if (resource.kind === "expert" && resource.institutionId) {
      const inst = idMap.get(`institution:${resource.institutionId}`);
      resource = { ...resource, institutionId: inst };
    }
    const evidence: EvidenceWithId[] = [...w.evidence.values()].map((e) => ({
      ...e,
      id: deterministicUuid(`${w.key}|${evidenceKey(e)}`),
    }));
    resource = { ...resource, evidenceRefs: evidence.map((e) => e.id) };
    const uniqueOriginals = [...new Set(w.originalIds)];
    if (w.originalIds.length > 1) {
      merged.push({ key: w.key, keptId: id, mergedFromIds: uniqueOriginals });
    }
    return { resource, key: w.key, evidence };
  });

  const canonicalConflicts = conflicts.map((c) => ({ ...c, recordId: deterministicUuid(c.key) }));
  return { kept, dropped, merged, conflicts: canonicalConflicts };
}

/**
 * Optional model pass. The proposer may only (a) propose merging two records that are already kept,
 * same kind, and (b) add conflict notes about existing keys. Unknown keys are ignored. No claims are added.
 */
export async function verifyWithProposals(
  results: readonly ResearchResult[],
  propose?: Proposer,
): Promise<VerifyOutput> {
  const base = verify(results);
  if (!propose) return base;

  const proposals = await propose(base.kept);
  const byKey = new Map(base.kept.map((k) => [k.key, k]));
  const absorbed = new Set<string>();
  const merged = [...base.merged];
  const conflicts = [...base.conflicts];

  for (const m of proposals.merges) {
    const [ka, kb] = m.keys;
    const a = byKey.get(ka);
    const b = byKey.get(kb);
    if (!a || !b || ka === kb || absorbed.has(ka) || absorbed.has(kb)) continue;
    if (a.resource.kind !== b.resource.kind) continue;
    absorbed.add(kb);
    const seen = new Set(a.evidence.map((e) => e.id));
    const combined = [...a.evidence, ...b.evidence.filter((e) => !seen.has(e.id))];
    byKey.set(ka, {
      ...a,
      resource: { ...mergeResources(a.resource, b.resource), id: a.resource.id, evidenceRefs: combined.map((e) => e.id) },
      evidence: combined,
    });
    merged.push({ key: ka, keptId: a.resource.id, mergedFromIds: [b.resource.id] });
  }
  for (const c of proposals.conflicts) {
    const rec = byKey.get(c.key);
    if (!rec) continue;
    conflicts.push({ key: c.key, recordId: rec.resource.id, reason: `[proposed] ${c.reason}`, values: [] });
  }

  return {
    kept: base.kept.filter((k) => !absorbed.has(k.key)).map((k) => byKey.get(k.key) ?? k),
    dropped: base.dropped,
    merged,
    conflicts,
  };
}
