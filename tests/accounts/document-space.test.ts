import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fakeEmbed, FAKE_EMBED_MODEL } from "../../lib/ai/embeddings";
import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { MAX_FILE_BYTES, updateDocumentSchema, type ExtractionOutput } from "../../lib/accounts/contract";
import { validateUpload } from "../../lib/accounts/upload";
import { MemoryAccountStore, setAccountStoreForTests } from "../../lib/accounts/store";
import { MemoryBlob } from "../../lib/accounts/blob";
import { createLibraryDocument, processLibraryDocument, updateLibraryDocument } from "../../lib/accounts/documents";
import { searchMedicalHistory } from "../../lib/accounts/retrieve";
import { searchCaseLibrary } from "../../lib/accounts/case-link";
import { claimCases } from "../../lib/accounts/lifecycle";
import { CASE_SCOPE_PREFIX, scopeForCase } from "../../lib/accounts/scope";
import { documentsForAgent, usedLabel } from "../../lib/accounts/agent-docs";
import { libraryDocsTool } from "../../lib/accounts/tool";
import { listSharedDocuments, searchSharedDocuments } from "../../lib/accounts/shared-docs";
import { MemoryDocumentUseStore } from "../../lib/accounts/uses";
import { reportFromDocuments, reportForScope } from "../../lib/accounts/report-text";
import { extractCase } from "../../lib/agents/intake-extractor";
import { recordToAnswers } from "../../components/intake/patient/answers";

const embedFake = async (t: string[]) => t.map(fakeEmbed);
const CASE_A = "11111111-1111-4111-8111-111111111111";
const CASE_B = "22222222-2222-4222-8222-222222222222";
const CASE_ANON = "33333333-3333-4333-8333-333333333333";

function setup() {
  const store = new MemoryAccountStore();
  const blob = new MemoryBlob();
  const owners = new MemoryOwnerStore();
  const uses = new MemoryDocumentUseStore();
  owners.registerCase(CASE_A, "sess-a", "acct-a");
  owners.registerCase(CASE_B, "sess-b", "acct-b");
  owners.registerCase(CASE_ANON, "sess-c", null);
  const pages = new Map<string, string>();
  const deps = {
    store, blob, owners, uses, embed: embedFake, embedModel: FAKE_EMBED_MODEL,
    extract: async ({ fileName }: { fileName: string }): Promise<ExtractionOutput> => ({
      method: "text", pages: [{ page: 1, section: null, text: pages.get(fileName) ?? "" }],
    }),
  };
  async function add(scope: string, title: string, text: string, docType = "genetic_test") {
    const fileName = `${title.replace(/\W+/g, "-")}.pdf`;
    pages.set(fileName, text);
    const created = await createLibraryDocument(scope, { title, docType, fileName, contentType: "application/pdf", sizeBytes: 10 } as never, deps);
    blob.put(created.pathname, new Uint8Array([1]), "application/pdf");
    return (await processLibraryDocument(scope, created.document.id, deps))!;
  }
  return { store, deps, add };
}

describe("upload validation (document space)", () => {
  const ok = { title: "Genetic report", docType: "genetic_test", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 1000 };
  it("rejects oversize files with the size-limit message", () => {
    const res = validateUpload({ ...ok, sizeBytes: MAX_FILE_BYTES + 1 });
    expect(res).toMatchObject({ ok: false, status: 413 });
    expect(res.ok ? "" : res.message).toMatch(/25 MB/);
  });
  it("accepts PDF, images, text and DOCX; rejects executables and mismatched extensions", () => {
    for (const [fileName, contentType] of [["a.pdf", "application/pdf"], ["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.txt", "text/plain"],
      ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]]) {
      expect(validateUpload({ ...ok, fileName, contentType }).ok).toBe(true);
    }
    expect(validateUpload({ ...ok, fileName: "a.exe", contentType: "application/octet-stream" })).toMatchObject({ ok: false, status: 415 });
    expect(validateUpload({ ...ok, fileName: "a.pdf", contentType: "image/png" })).toMatchObject({ ok: false, status: 415 });
    expect(validateUpload({ ...ok, title: " " })).toMatchObject({ ok: false, status: 422 });
  });
});

describe("scoping: one scope can never retrieve another's chunks", () => {
  it("keeps accounts, anonymous cases and drafts apart in search", async () => {
    const { deps, add } = setup();
    await add("acct-a", "A genetic report", "COL3A1 pathogenic variant for account A");
    await add("acct-b", "B genetic report", "COL3A1 pathogenic variant for account B");
    await add(`${CASE_SCOPE_PREFIX}${CASE_ANON}`, "Anon report", "COL3A1 pathogenic variant for the anonymous case");
    await add("draft:sess-d", "Draft report", "COL3A1 pathogenic variant in a draft");

    const titles = async (scope: string) => (await searchMedicalHistory(scope, "COL3A1 variant", 20, deps)).map(h => h.title);
    expect(await titles("acct-a")).toEqual(["A genetic report"]);
    expect(await titles("acct-b")).toEqual(["B genetic report"]);
    expect(await titles(`${CASE_SCOPE_PREFIX}${CASE_ANON}`)).toEqual(["Anon report"]);
    expect(await titles("draft:sess-d")).toEqual(["Draft report"]);
    expect(await titles("acct-nobody")).toEqual([]);
  });

  it("resolves a case to its own account or its own space, never another's", async () => {
    const { deps, add } = setup();
    await add("acct-a", "A genetic report", "COL3A1 pathogenic variant for account A");
    await add("acct-b", "B genetic report", "COL3A1 pathogenic variant for account B");
    await add(`${CASE_SCOPE_PREFIX}${CASE_ANON}`, "Anon report", "COL3A1 pathogenic variant for the anonymous case");
    const titles = async (caseId: string) => (await searchCaseLibrary(caseId, "COL3A1 variant", 20, deps)).results.map(h => h.title);
    expect(await titles(CASE_A)).toEqual(["A genetic report"]);
    expect(await titles(CASE_B)).toEqual(["B genetic report"]);
    expect(await titles(CASE_ANON)).toEqual(["Anon report"]);
    expect((await documentsForAgent(CASE_A, "research", "COL3A1", deps)).hits.every(h => h.title === "A genetic report")).toBe(true);
    const tool = libraryDocsTool(CASE_B, "inbox", deps);
    const rows = (await tool.handler({ query: "COL3A1 variant", k: 10 } as never)) as { title: string }[];
    expect(rows.map(r => r.title)).toEqual(["B genetic report"]);
  });

  it("treats a foreign document id as missing for reads and edits", async () => {
    const { store, deps, add } = setup();
    const doc = await add("acct-a", "Private", "private text");
    expect(await store.getDocument("acct-b", doc.id)).toBeUndefined();
    expect(await updateLibraryDocument("acct-b", doc.id, { title: "Hijacked" }, deps)).toBeUndefined();
    expect((await store.getDocument("acct-a", doc.id))?.title).toBe("Private");
  });

  it("moves a draft into the case scope and an anonymous case into the account on claim", async () => {
    const { store, deps, add } = setup();
    await add("draft:sess-c", "Intake upload", "COL3A1 pathogenic variant");
    expect(await store.moveScope("draft:sess-c", await scopeForCase(CASE_ANON, deps.owners))).toBe(1);
    expect((await searchCaseLibrary(CASE_ANON, "COL3A1", 5, deps)).results).toHaveLength(1);
    expect(await searchMedicalHistory("draft:sess-c", "COL3A1", 5, deps)).toEqual([]);

    setAccountStoreForTests(store);
    try {
      expect(await claimCases("sess-c", "acct-c", deps.owners)).toBe(1);
    } finally {
      setAccountStoreForTests(undefined);
    }
    expect((await store.listDocuments("acct-c")).map(d => d.title)).toEqual(["Intake upload"]);
    expect(await store.listDocuments(`${CASE_SCOPE_PREFIX}${CASE_ANON}`)).toEqual([]);
  });
});

describe("share with resources flag", () => {
  it("defaults to off, is invisible to resource agents until turned on, and can be turned back off", async () => {
    const { deps, add } = setup();
    const doc = await add("acct-a", "Genetic report", "COL3A1 pathogenic variant");
    expect(doc.shareWithResources).toBe(false);
    expect(await listSharedDocuments(CASE_A, deps)).toEqual([]);
    expect(await searchSharedDocuments(CASE_A, "resource:x", "COL3A1", 4, deps)).toEqual([]);

    expect(updateDocumentSchema.parse({ shareWithResources: true })).toEqual({ shareWithResources: true });
    expect(await updateLibraryDocument("acct-a", doc.id, { shareWithResources: true }, deps)).toMatchObject({ shareWithResources: true });
    expect(await listSharedDocuments(CASE_A, deps)).toMatchObject([{ id: doc.id, title: "Genetic report" }]);
    expect((await searchSharedDocuments(CASE_A, "resource:x", "COL3A1", 4, deps)).map(h => h.title)).toEqual(["Genetic report"]);
    // Another case never sees it, shared or not.
    expect(await listSharedDocuments(CASE_B, deps)).toEqual([]);

    await updateLibraryDocument("acct-a", doc.id, { shareWithResources: false }, deps);
    expect(await searchSharedDocuments(CASE_A, "resource:x", "COL3A1", 4, deps)).toEqual([]);
  });
});

describe("agents record which documents they used", () => {
  it("records distinct documents per agent and words the count", async () => {
    const { deps, add } = setup();
    await add("acct-a", "Genetic report", "COL3A1 pathogenic variant c.1834G>A");
    await add("acct-a", "Clinic letter", "Dr Rivera confirmed vascular Ehlers-Danlos syndrome", "letter");
    const found = await documentsForAgent(CASE_A, "needs", "vascular Ehlers-Danlos COL3A1", deps);
    expect(found.used.map(u => u.title).sort()).toEqual(["Clinic letter", "Genetic report"]);
    expect(found.block).toContain("UNTRUSTED DATA");
    expect(await deps.uses.list(CASE_A)).toHaveLength(2);
    expect(await deps.uses.list(CASE_B)).toEqual([]);
    expect(usedLabel(2)).toBe("Used 2 of your documents");
    expect(usedLabel(1)).toBe("Used 1 of your documents");
    // No documents: empty, never throws.
    expect(await documentsForAgent(CASE_B, "needs", "anything", deps)).toMatchObject({ block: "", used: [] });
  });
});

describe("intake prefill from a fixture genetic report", () => {
  const reportText = readFileSync(path.join(process.cwd(), "fixtures/documents/synthetic-genetic-report.txt"), "utf8");

  it("builds a sanitized report from embedded documents only, then pre-fills the case", async () => {
    const { store, deps, add } = setup();
    await add("draft:sess-d", "Genetic report", reportText);
    const pending = await createLibraryDocument("draft:sess-d", { title: "Still uploading", docType: "other", fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 3 }, deps);
    expect(pending.document.status).toBe("pending_upload");

    const report = await reportForScope("draft:sess-d", undefined, store);
    expect(report.titles).toEqual(["Genetic report"]);
    expect(report.reportText).toContain("COL3A1");
    expect(report.reportText).toContain("Genetic test: Genetic report");
    expect(report.reportText).not.toMatch(/ignore previous instructions/i);

    const input = await extractCase(report.reportText, { offlineKey: "genetic-report-synthetic" });
    expect(input).toMatchObject({ diseaseName: "Vascular Ehlers-Danlos syndrome", homeCity: "Columbus", homeState: "OH", travelLimitMiles: 300 });
    const answers = recordToAnswers({ id: "c", ...input, status: "draft", createdAt: "", updatedAt: "" } as never);
    expect(answers).toMatchObject({ condition: "Vascular Ehlers-Danlos syndrome", city: "Columbus", state: "OH" });
  });

  it("returns nothing for scopes without readable documents", async () => {
    const { store } = setup();
    expect((await reportForScope("acct-nobody", undefined, store)).reportText).toBe("");
    expect(reportFromDocuments([{ title: "x", docType: "other", text: null, status: "embedded" }]).titles).toEqual([]);
  });
});
