import type { CallTurn } from "./types";

const LINE = /^\s*(AI|Agent|Assistant|Callee|Human|Caller|Them)\s*:\s*(.*)$/i;

/**
 * Splits a final `calls.transcript` ("AI: ...\nCallee: ...") into turns. A line that does not start with a speaker
 * label continues the previous turn. Seq is the line index; there are no per-line timestamps in this format.
 */
export function parseTranscript(transcript: string | null | undefined): CallTurn[] {
  if (!transcript) return [];
  const turns: CallTurn[] = [];
  for (const raw of transcript.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = LINE.exec(raw);
    if (m) {
      const role = /^(ai|agent|assistant)$/i.test(m[1]) ? "ai" : "human";
      turns.push({ seq: turns.length, role, text: m[2].trim(), at: null });
    } else if (turns.length > 0) {
      const last = turns[turns.length - 1];
      turns[turns.length - 1] = { ...last, text: `${last.text} ${raw.trim()}`.trim() };
    } else {
      turns.push({ seq: 0, role: "human", text: raw.trim(), at: null });
    }
  }
  return turns.filter((t) => t.text.length > 0);
}
