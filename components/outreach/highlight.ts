export type TextRun = { text: string; shared: boolean };

/** Split a draft into runs, marking exact shared-field values. Longer values win. */
export function highlightSharedValues(body: string, values: readonly string[]): TextRun[] {
  const needles = [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 1))].sort(
    (a, b) => b.length - a.length,
  );
  if (needles.length === 0 || body.length === 0) return [{ text: body, shared: false }];

  const marks: { start: number; end: number }[] = [];
  const lower = body.toLowerCase();
  for (const needle of needles) {
    const probe = needle.toLowerCase();
    let offset = lower.indexOf(probe);
    while (offset !== -1) {
      const end = offset + probe.length;
      const overlaps = marks.some((mark) => offset < mark.end && end > mark.start);
      if (!overlaps) marks.push({ start: offset, end });
      offset = lower.indexOf(probe, offset + probe.length);
    }
  }
  marks.sort((a, b) => a.start - b.start);

  const runs: TextRun[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start > cursor) runs.push({ text: body.slice(cursor, mark.start), shared: false });
    runs.push({ text: body.slice(mark.start, mark.end), shared: true });
    cursor = mark.end;
  }
  if (cursor < body.length) runs.push({ text: body.slice(cursor), shared: false });
  return runs.length > 0 ? runs : [{ text: body, shared: false }];
}
