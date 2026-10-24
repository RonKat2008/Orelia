import type { HistoryDocument } from './contract';

/** Title under which a record's chunks are stored in the per-case vector store; ends with the document id. */
export function vectorTitle(doc: Pick<HistoryDocument, 'id' | 'title'>): string {
  return `${doc.title} (${doc.id})`;
}
const VECTOR_TITLE_ID = /\(([0-9a-f-]{36})\)$/;
export function docIdFromVectorTitle(title: string): string | undefined {
  return VECTOR_TITLE_ID.exec(title)?.[1];
}
