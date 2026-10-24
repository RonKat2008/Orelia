/** Builds a tiny valid PDF in memory (synthetic text only). `pages` is an array of lines per page; empty page = no text. */
export function makePdf(pages: string[][], opts: { encrypt?: boolean } = {}): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesIdx = objs.length + 1 + pages.length * 2 + 1; // placeholder, fixed below
  void pagesIdx;
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const lines of pages) {
    const stream = lines.length
      ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map(l => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ')} ET`
      : '';
    contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    pageIds.push(0);
  }
  const pagesObj = objs.length + pages.length + 1;
  pages.forEach((_, i) => { pageIds[i] = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`); });
  add(`<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  let encryptRef = '';
  if (opts.encrypt) {
    const e = add('<< /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>');
    encryptRef = ` /Encrypt ${e} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]`;
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${encryptRef} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
