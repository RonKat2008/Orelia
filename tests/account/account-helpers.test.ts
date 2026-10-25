import { describe, expect, it } from "vitest";
import type { LibraryDocument } from "@/lib/accounts/contract";
import { filterDocuments, EMPTY_FILTERS, hasActiveFilters } from "@/components/account/helpers/filter";
import { parseTags, resolveContentType, titleFromFileName, validateFile } from "@/components/account/helpers/files";
import { metadataFromDraft, draftForFile } from "@/components/account/helpers/metadata";
import { safeNext, signInHref } from "@/components/account/helpers/safe-next";

const doc = (over: Partial<LibraryDocument>): LibraryDocument => ({
  id: "1", title: "CBC panel", docType: "lab", dateOfService: "2025-03-02", provider: "Mercy Clinic", notes: null,
  tags: ["blood"], fileName: "cbc.pdf", contentType: "application/pdf", sizeBytes: 10, shareWithResources: false, status: "embedded",
  statusDetail: null, pageCount: 1, chunkCount: 1, createdAt: "2025-03-03T00:00:00Z", updatedAt: "2025-03-03T00:00:00Z",
  ...over,
});

describe("safeNext", () => {
  it("allows relative paths", () => {
    expect(safeNext("/cases/abc?x=1")).toBe("/cases/abc?x=1");
  });
  it("rejects open redirects", () => {
    for (const bad of ["//evil.com", "https://evil.com", "evil", "/\\evil.com", "/a\nb", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/account");
    }
  });
  it("builds a sign-in link", () => {
    expect(signInHref("/cases/1?a=b")).toBe("/auth/sign-in?next=%2Fcases%2F1%3Fa%3Db");
  });
});

describe("file helpers", () => {
  it("validates size and type", () => {
    expect(validateFile({ name: "a.pdf", type: "application/pdf", size: 100 })).toBeNull();
    expect(validateFile({ name: "a.exe", type: "application/x-msdownload", size: 100 })).toMatch(/not a type/);
    expect(validateFile({ name: "a.pdf", type: "application/pdf", size: 26 * 1024 * 1024 })).toMatch(/up to 25/);
    expect(validateFile({ name: "a.pdf", type: "application/pdf", size: 0 })).toMatch(/empty/);
  });
  it("falls back to the extension when the browser reports no type", () => {
    expect(resolveContentType({ name: "scan.JPG", type: "" })).toBe("image/jpeg");
    expect(resolveContentType({ name: "x.zip", type: "" })).toBeNull();
  });
  it("derives titles and tags", () => {
    expect(titleFromFileName("blood_work  2025.final.pdf")).toBe("blood work 2025.final");
    expect(parseTags(" a, B,a ,, c")).toEqual(["a", "B", "c"]);
  });
});

describe("filterDocuments", () => {
  const docs = [
    doc({ id: "1" }),
    doc({ id: "2", title: "Chest MRI", docType: "imaging", dateOfService: "2024-01-10", provider: "City Radiology", tags: ["mri"] }),
    doc({ id: "3", title: "Letter", docType: "letter", dateOfService: null, tags: [], notes: "from insurer" }),
  ];
  it("searches title, provider, tags and notes", () => {
    expect(filterDocuments(docs, { ...EMPTY_FILTERS, query: "radiology" }).map(d => d.id)).toEqual(["2"]);
    expect(filterDocuments(docs, { ...EMPTY_FILTERS, query: "blood" }).map(d => d.id)).toEqual(["1"]);
    expect(filterDocuments(docs, { ...EMPTY_FILTERS, query: "insurer" }).map(d => d.id)).toEqual(["3"]);
  });
  it("filters by type and date range", () => {
    expect(filterDocuments(docs, { ...EMPTY_FILTERS, docType: "imaging" }).map(d => d.id)).toEqual(["2"]);
    expect(filterDocuments(docs, { ...EMPTY_FILTERS, from: "2025-01-01" }).map(d => d.id)).toEqual(["1"]);
    expect(filterDocuments(docs, { ...EMPTY_FILTERS, to: "2024-12-31" }).map(d => d.id)).toEqual(["2"]);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });
});

describe("metadataFromDraft", () => {
  it("accepts a default draft and reports a missing title", () => {
    const ok = metadataFromDraft(draftForFile("labs.pdf"));
    expect(ok.ok).toBe(true);
    const bad = metadataFromDraft({ ...draftForFile("labs.pdf"), title: "  " });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.title).toBeTruthy();
  });
});
