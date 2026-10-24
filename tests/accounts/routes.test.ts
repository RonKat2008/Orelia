import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeaderAccountResolver, setAccountResolverForTests } from "../../lib/accounts/current";
import { MemoryAccountStore, setAccountStoreForTests } from "../../lib/accounts/store";
import { MemoryBlob, setBlobForTests } from "../../lib/accounts/blob";
import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { GET as accountGet, DELETE as accountDelete } from "../../app/api/account/route";
import { POST as claim } from "../../app/api/account/claim/route";
import { GET as profileGet, PUT as profilePut } from "../../app/api/account/profile/route";
import { GET as docsGet, POST as docsPost } from "../../app/api/account/documents/route";
import { GET as docGet, PATCH as docPatch, DELETE as docDelete } from "../../app/api/account/documents/[docId]/route";
import { POST as processDoc } from "../../app/api/account/documents/[docId]/process/route";
import { GET as fileGet } from "../../app/api/account/documents/[docId]/file/route";
import { POST as uploadToken } from "../../app/api/account/documents/upload/route";
import { GET as search } from "../../app/api/account/search/route";
import { GET as caseDocs } from "../../app/api/cases/[id]/my-documents/route";
import { POST as importLibrary } from "../../app/api/cases/[id]/history/import-library/route";

const ORIGIN = "http://localhost";
const SECRET = "test-secret";
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
let store: MemoryAccountStore;
let blob: MemoryBlob;
let owners: MemoryOwnerStore;
const saved: Record<string, string | undefined> = {};

function req(path: string, opts: { method?: string; account?: string; body?: unknown; origin?: string; session?: string } = {}) {
  const headers: Record<string, string> = { origin: opts.origin ?? ORIGIN, "content-type": "application/json" };
  if (opts.account) headers["x-test-account"] = opts.account;
  if (opts.session) headers.cookie = `wf_session=${signSession(opts.session, { WAYFINDER_SESSION_SECRET: SECRET })}`;
  return new Request(`${ORIGIN}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const ctx = (docId: string) => ({ params: Promise.resolve({ docId }) });
const cctx = (id: string) => ({ params: Promise.resolve({ id }) });
const newDoc = { title: "CBC panel", docType: "lab", fileName: "cbc.txt", contentType: "text/plain", sizeBytes: 40 };

beforeEach(() => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "DATABASE_URL", "WAYFINDER_OFFLINE", "NEON_AI_GATEWAY_BASE_URL", "NEON_AI_GATEWAY_TOKEN"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  process.env.WAYFINDER_OFFLINE = "1";
  delete process.env.DATABASE_URL;
  delete process.env.NEON_AI_GATEWAY_BASE_URL;
  delete process.env.NEON_AI_GATEWAY_TOKEN;
  store = new MemoryAccountStore();
  blob = new MemoryBlob();
  owners = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = owners;
  setAccountStoreForTests(store);
  setBlobForTests(blob);
  setAccountResolverForTests(new HeaderAccountResolver());
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setAccountStoreForTests(undefined);
  setBlobForTests(undefined);
  setAccountResolverForTests(undefined);
  delete holder.__wayfinderOwnerStore;
});

async function uploadText(account: string, text: string, title = "CBC panel") {
  const res = await docsPost(req("/api/account/documents", { method: "POST", account, body: { ...newDoc, title } }));
  expect(res.status).toBe(201);
  const { document, upload } = await res.json();
  blob.put(upload.pathname, new TextEncoder().encode(text), "text/plain");
  const processed = await processDoc(req(`/api/account/documents/${document.id}/process`, { method: "POST", account }), ctx(document.id));
  return (await processed.json()).document;
}

describe("account routes", () => {
  it("anonymous: GET /api/account works, everything else is an opaque 404", async () => {
    expect((await (await accountGet(req("/api/account"))).json()).account).toBeNull();
    expect((await profileGet(req("/api/account/profile"))).status).toBe(404);
    expect((await docsGet(req("/api/account/documents"))).status).toBe(404);
    expect((await claim(req("/api/account/claim", { method: "POST" }))).status).toBe(404);
  });
  it("CSRF: cross-origin writes are refused before auth", async () => {
    expect((await profilePut(req("/api/account/profile", { method: "PUT", account: "A", origin: "https://evil.example", body: {} }))).status).toBe(403);
    expect((await docsPost(req("/api/account/documents", { method: "POST", account: "A", origin: "https://evil.example", body: newDoc }))).status).toBe(403);
  });
  it("profile: adult rule and validation", async () => {
    const minor = await profilePut(req("/api/account/profile", { method: "PUT", account: "A", body: { preferredName: "K", dateOfBirth: "2015-01-01" } }));
    expect(minor.status).toBe(422);
    expect((await minor.json()).error).toBe("adult_only");
    const ok = await profilePut(req("/api/account/profile", { method: "PUT", account: "A", body: { preferredName: "Alpha", dateOfBirth: "1990-01-01" } }));
    expect(ok.status).toBe(200);
    expect((await (await profileGet(req("/api/account/profile", { account: "A" }))).json()).profile.preferredName).toBe("Alpha");
    expect((await (await profileGet(req("/api/account/profile", { account: "B" }))).json()).profile).toBeNull();
  });
  it("upload validation is server-side", async () => {
    expect((await docsPost(req("/api/account/documents", { method: "POST", account: "A", body: { ...newDoc, sizeBytes: 26 * 1024 * 1024 } }))).status).toBe(413);
    expect((await docsPost(req("/api/account/documents", { method: "POST", account: "A", body: { ...newDoc, fileName: "x.svg", contentType: "image/svg+xml" } }))).status).toBe(415);
  });
  it("upload token: only the owner, only the reserved pathname", async () => {
    const res = await docsPost(req("/api/account/documents", { method: "POST", account: "A", body: newDoc }));
    const { document, upload } = await res.json();
    const body = (pathname: string, payload: string) => ({ type: "blob.generate-client-token", payload: { pathname, clientPayload: payload, multipart: false } });
    expect((await uploadToken(req("/api/account/documents/upload", { method: "POST", body: body(upload.pathname, document.id) }))).status).toBe(404);
    expect((await uploadToken(req("/api/account/documents/upload", { method: "POST", account: "B", body: body(upload.pathname, document.id) }))).status).toBe(400);
    expect((await uploadToken(req("/api/account/documents/upload", { method: "POST", account: "A", body: body("accounts/A/other.txt", document.id) }))).status).toBe(400);
    const prev = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_" + "x".repeat(24);
    try {
      const good = await uploadToken(req("/api/account/documents/upload", { method: "POST", account: "A", body: body(upload.pathname, document.id) }));
      expect(good.status).toBe(200);
      expect((await good.json()).clientToken).toBeTruthy();
      expect((await uploadToken(req("/api/account/documents/upload", { method: "POST", account: "B", body: body(upload.pathname, document.id) }))).status).toBe(400);
    } finally {
      if (prev === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = prev;
    }
  });
  it("documents: A's documents are invisible to B (list, get, patch, file, process, delete)", async () => {
    const doc = await uploadText("A", "Hemoglobin 13.2 g/dL. COL3A1 variant previously reported.");
    expect(doc.status).toBe("embedded");
    expect((await (await docsGet(req("/api/account/documents", { account: "B" }))).json()).documents).toEqual([]);
    expect((await docGet(req(`/x`, { account: "B" }), ctx(doc.id))).status).toBe(404);
    expect((await docPatch(req(`/x`, { method: "PATCH", account: "B", body: { title: "pwned" } }), ctx(doc.id))).status).toBe(404);
    expect((await fileGet(req(`/x`, { account: "B" }), ctx(doc.id))).status).toBe(404);
    expect((await processDoc(req(`/x`, { method: "POST", account: "B" }), ctx(doc.id))).status).toBe(404);
    expect((await docDelete(req(`/x`, { method: "DELETE", account: "B" }), ctx(doc.id))).status).toBe(404);
    const file = await fileGet(req(`/x`, { account: "A" }), ctx(doc.id));
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toContain("no-store");
    expect(await file.text()).toContain("Hemoglobin");
  });
  it("search: B's query never returns A's chunks", async () => {
    await uploadText("A", "COL3A1 vascular surveillance imaging plan");
    const a = await (await search(req("/api/account/search?q=COL3A1", { account: "A" }))).json();
    expect(a.results[0].title).toBe("CBC panel");
    const b = await (await search(req("/api/account/search?q=COL3A1", { account: "B" }))).json();
    expect(b.results).toEqual([]);
  });
  it("delete document removes the blob; delete account requires confirmation", async () => {
    const doc = await uploadText("A", "some text here");
    expect(blob.files.size).toBe(1);
    expect((await docDelete(req(`/x`, { method: "DELETE", account: "A" }), ctx(doc.id))).status).toBe(204);
    expect(blob.files.size).toBe(0);
    expect((await accountDelete(req("/api/account", { method: "DELETE", account: "A", body: {} }))).status).toBe(400);
  });
  it("case routes: claim, then the case library is the owning account's only", async () => {
    await uploadText("A", "COL3A1 vascular ehlers danlos note");
    const caseId = "00000000-0000-4000-8000-0000000000aa";
    owners.registerCase(caseId, "s1");
    expect((await (await claim(req("/api/account/claim", { method: "POST", account: "A", session: "s1" }))).json()).claimed).toBe(1);
    const mine = await (await caseDocs(req(`/x?q=COL3A1`, { account: "A" }), cctx(caseId))).json();
    expect(mine.available).toBe(true);
    expect(mine.results[0].citation).toContain("CBC panel");
    expect((await caseDocs(req(`/x?q=COL3A1`, { account: "B" }), cctx(caseId))).status).toBe(404);
    expect((await importLibrary(req(`/x`, { method: "POST", account: "B" }), cctx(caseId))).status).toBe(404);
    const imported = await importLibrary(req(`/x`, { method: "POST", account: "A" }), cctx(caseId));
    expect((await imported.json()).imported).toBe(1);
  });
});
