import { chat } from '@/lib/ai/chat';
import { hasClaudeCredentials } from '@/lib/ai/gateway';
import type { ExtractionResult, HistoryDocument } from './contract';
import { buildLlmMessages, groundLlmOutput } from './extract-llm';
import { extractEventsWithRules } from './extract-rules';

export { inferDocType } from './doc-type';
export { extractEventsWithRules } from './extract-rules';

/**
 * Rules first (deterministic, offline). With opts.llm and a gateway (or an injected chatFn) the model organises
 * the record instead; its output is Zod-validated and every finding must appear verbatim in doc.text, else it is
 * dropped. Any failure falls back to the rule extraction.
 */
export async function extractEvents(
  doc: HistoryDocument,
  opts: { llm?: boolean; chatFn?: typeof chat } = {},
): Promise<ExtractionResult> {
  const rules = (): ExtractionResult => ({ events: extractEventsWithRules(doc), extractedBy: 'rules' });
  if (!opts.llm || !(opts.chatFn || hasClaudeCredentials())) return rules();
  try {
    const raw = await (opts.chatFn ?? chat)({ role: 'history', messages: buildLlmMessages(doc) });
    const events = groundLlmOutput(doc, raw);
    return events ? { events, extractedBy: 'llm' } : rules();
  } catch {
    return rules();
  }
}
