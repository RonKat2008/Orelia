import { neutralizeUntrusted } from '@/lib/agents/research/untrusted';
import { MAX_RECORD_CHARS } from './contract';

// Multi-line hidden content has to go before the text is split into lines.
const HIDDEN_BLOCKS = /<(script|style|noscript|template|iframe|object)\b[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;

/**
 * Uploaded record text is untrusted DATA. This strips hidden markup, invisible characters, fake delimiters and
 * instruction-like sentences while keeping the line structure the extractor and the span offsets rely on
 * (neutralizeUntrusted flattens newlines, so it runs line by line). Capped at MAX_RECORD_CHARS.
 */
export function sanitizeRecordText(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').replace(HTML_COMMENTS, ' ').replace(HIDDEN_BLOCKS, ' ');
  const lines = normalized.split('\n').map(line => neutralizeUntrusted(line));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_RECORD_CHARS);
}
