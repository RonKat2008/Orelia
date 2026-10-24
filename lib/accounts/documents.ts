/**
 * Medical-document library service: create (metadata first, then a private direct upload), process (extract ->
 * chunk with page refs -> embed into the account's vector space), edit, delete (blob + chunks + row).
 * Document text is untrusted DATA: it is sanitized at extraction and never logged.
 */
import { randomUUID } from 'node:crypto';
import { chunkPages } from '@/lib/case-docs/chunk';
import { embed, embeddingModel } from '@/lib/ai/embeddings';
import { MAX_RECORD_CHARS } from '@/lib/history/contract';
import { ExtractionError, MAX_FILE_BYTES, type CreateDocumentBody, type ExtractionOutput, type LibraryDocument } from './contract';
import { getBlob, readAll, type BlobPort } from './blob';
import { extractDocumentText, type ExtractionInput } from './extract';
import { getAccountStore, toLibraryDocument, type AccountStore, type DocumentPatch } from './store';
import { blobPathnameFor } from './upload';

export interface LibraryDeps {
  store?: AccountStore;
  blob?: BlobPort;
  extract?: (input: ExtractionInput) => Promise<ExtractionOutput>;
  embed?: (texts: string[]) => Promise<number[][]>;
  embedModel?: string;
}
const storeOf = (d: LibraryDeps) => d.store ?? getAccountStore();

export async function createLibraryDocument(accountId: string, body: CreateDocumentBody, deps: LibraryDeps = {}) {
  const id = randomUUID();
  const row = await storeOf(deps).createDocument({
    id, accountId, title: body.title, docType: body.docType, dateOfService: body.dateOfService ?? null,
    provider: body.provider ?? null, notes: body.notes ?? null, tags: body.tags ?? [], fileName: body.fileName,
    contentType: body.contentType, sizeBytes: body.sizeBytes, blobPathname: blobPathnameFor(accountId, id, body.fileName),
  });
  return { document: toLibraryDocument(row), pathname: row.blobPathname };
}

export async function listLibrary(accountId: string, q?: string, deps: LibraryDeps = {}): Promise<LibraryDocument[]> {
  const docs = (await storeOf(deps).listDocuments(accountId)).map(toLibraryDocument);
  const term = q?.trim().toLowerCase();
  if (!term) return docs;
  return docs.filter(d => [d.title, d.provider ?? '', d.notes ?? '', d.fileName, ...d.tags].join(' ').toLowerCase().includes(term));
}

export async function updateLibraryDocument(accountId: string, id: string, patch: DocumentPatch, deps: LibraryDeps = {}) {
  const row = await storeOf(deps).updateDocument(accountId, id, patch);
  return row ? toLibraryDocument(row) : undefined;
}

/** Deletes the blob, the chunks/embeddings (cascade) and the row. Returns false for a missing or foreign id. */
export async function deleteLibraryDocument(accountId: string, id: string, deps: LibraryDeps = {}): Promise<boolean> {
  const store = storeOf(deps);
  const row = await store.getDocument(accountId, id);
  if (!row) return false;
  await (deps.blob ?? getBlob()).remove([row.blobPathname]);
  await store.deleteDocument(accountId, id);
  return true;
}

const PAGE_CAP = MAX_RECORD_CHARS * 4;
const FRIENDLY_FAILURE = 'We could not read this file. Try again, or upload a PDF or a clear photo.';

/**
 * Inline processing (no queue in prod): uploaded -> extracting -> embedded | failed. Idempotent: a retry replaces the
 * document's chunks. Stays well inside the function limit (extraction 55 s cap for images).
 */
export async function processLibraryDocument(accountId: string, id: string, deps: LibraryDeps = {}): Promise<LibraryDocument | undefined> {
  const store = storeOf(deps);
  const row = await store.getDocument(accountId, id);
  if (!row) return undefined;
  // Atomic claim: two concurrent runs (double click, two tabs) must not both rewrite the document's chunks.
  if (!(await store.claimForProcessing(accountId, id, 90_000))) {
    const current = await store.getDocument(accountId, id);
    return current ? toLibraryDocument(current) : undefined;
  }
  try {
    const file = await (deps.blob ?? getBlob()).read(row.blobPathname);
    if (!file) {
      return toLibraryDocument((await store.updateDocument(accountId, id, {
        status: 'failed', statusDetail: 'The upload did not finish. Please upload the file again.',
      }))!);
    }
    const bytes = await readAll(file.stream, MAX_FILE_BYTES);
    const output = await (deps.extract ?? extractDocumentText)({ bytes, contentType: row.contentType, fileName: row.fileName });
    const pages = output.pages.filter(p => p.text.trim());
    if (!pages.length) {
      await store.replaceChunks(accountId, id, []);
      return toLibraryDocument((await store.updateDocument(accountId, id, {
        status: 'failed', statusDetail: output.note ?? 'No readable text was found in this file.', chunkCount: 0, text: null,
      }))!);
    }
    const chunks = chunkPages(pages);
    const vectors = await (deps.embed ?? embed)(chunks.map(c => c.content));
    const model = deps.embedModel ?? embeddingModel();
    await store.replaceChunks(accountId, id, chunks.map((c, i) => ({
      accountId, documentId: id, chunkIndex: c.chunkIndex, page: c.page, section: c.section, content: c.content,
      embedding: vectors[i], embedModel: model,
    })));
    const text = pages.map(p => (p.page ? `[Page ${p.page}]\n${p.text}` : p.text)).join('\n\n').slice(0, PAGE_CAP);
    const pageCount = pages.some(p => p.page) ? Math.max(...pages.map(p => p.page ?? 0)) : null;
    return toLibraryDocument((await store.updateDocument(accountId, id, {
      status: 'embedded', statusDetail: output.note ?? null, chunkCount: chunks.length, pageCount, text,
    }))!);
  } catch (err) {
    console.error('[accounts] document processing failed', err instanceof Error ? err.name : 'error');
    const detail = err instanceof ExtractionError ? err.message : FRIENDLY_FAILURE;
    const failed = await store.updateDocument(accountId, id, { status: 'failed', statusDetail: detail.slice(0, 300) });
    return failed ? toLibraryDocument(failed) : undefined;
  }
}

/** Marks a document as uploaded (called from the blob upload-completed callback and before processing). */
export async function markUploaded(accountId: string, id: string, deps: LibraryDeps = {}) {
  const store = storeOf(deps);
  const row = await store.getDocument(accountId, id);
  if (row && row.status === 'pending_upload') await store.updateDocument(accountId, id, { status: 'uploaded' });
}
