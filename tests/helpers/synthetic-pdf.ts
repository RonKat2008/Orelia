/** Builds a minimal valid PDF in memory with correct xref offsets. Synthetic text only, never real PHI. */
export function makeSyntheticPdf(pages: string[][], opts: { encrypt?: boolean } = {}): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body);
  const escape = (s: string) => s.replace(/[()\\]/g, '');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 1
  const pagesId = 2 + pages.length * 2;
  const contentIds: number[] = [];
  const pageIds: number[] = [];
  pages.forEach((lines, i) => {
    const stream = lines.length ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map(l => `(${escape(l)}) Tj T*`).join(' ')} ET` : '';
    contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`));
  });
  add(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let encrypt = '';
  if (opts.encrypt) {
    const id = add('<< /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>');
    encrypt = ` /Encrypt ${id} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]`;
  }
  let out = '%PDF-1.4\n';
  const offsets = objs.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
