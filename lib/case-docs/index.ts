import { embed, embeddingModel } from '@/lib/ai/embeddings';
import type { DocumentKind } from '@/lib/contracts/case-docs';
import { chunk } from './chunk';
import { MemoryDocumentStore, PUBLIC_KINDS, type DocumentStore, type SearchInput } from './store';
import { PostgresDocumentStore } from './postgres-store';
export { chunk } from './chunk';
export * from './store';
export { PostgresDocumentStore } from './postgres-store';

const state = globalThis as unknown as { __wayfinderDocuments?: DocumentStore };
export function getDocumentStore(): DocumentStore {
  return state.__wayfinderDocuments ??= process.env.DATABASE_URL && process.env.WAYFINDER_OFFLINE !== '1'
    ? new PostgresDocumentStore() : new MemoryDocumentStore();
}
export interface IngestInput {
  caseId: string; contactId?: string; kind: DocumentKind; title: string;
  sourceUrl?: string; sharedField?: string | null; text: string;
}
export async function ingest(input: IngestInput, store = getDocumentStore()) {
  const texts = chunk(input.text);
  const model = embeddingModel();
  const vectors = await embed(texts);
  // Missing patient metadata must never turn private text into public text.
  const sharedField = input.kind === 'intake_report' ? 'intakeReport'
    : input.sharedField ?? ((PUBLIC_KINDS as readonly string[]).includes(input.kind) ? null : 'unshared');
  return store.insert(texts.map((content, chunkIndex) => ({
    caseId: input.caseId, contactId: input.contactId ?? null, kind: input.kind, title: input.title,
    sourceUrl: input.sourceUrl ?? null, sharedField, chunkIndex, content, embedding: vectors[chunkIndex], embedModel: model,
  })));
}
export async function search(input: SearchInput, store = getDocumentStore()) {
  const model = embeddingModel();
  const [embedding] = await embed([input.query]);
  return store.search({ ...input, embedding, embedModel: model });
}
