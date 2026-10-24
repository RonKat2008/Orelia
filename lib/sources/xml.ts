/** Small non-validating XML reader: no DTD loading, entity expansion, or network I/O. */
export interface XmlNode { name: string; children: XmlNode[]; text: string }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n <= 0x10ffff ? String.fromCodePoint(n) : ""; }
  return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"} as Record<string,string>)[e] ?? "";
});
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = {name: "root", children: [], text: ""};
  const stack = [root];
  for (const token of xml.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("<![CDATA[")) { stack[stack.length - 1].text += token.slice(9, -3); continue; }
    if (/^<[!?]/.test(token)) continue;
    if (token.startsWith("</")) {
      if (stack.length === 1 || stack[stack.length - 1].name !== token.slice(2, -1).trim()) throw new Error("Malformed XML");
      const node = stack.pop()!; stack[stack.length - 1].text += node.text;
    } else if (token.startsWith("<")) {
      const node: XmlNode = {name: token.match(/^<([^\s/>]+)/)![1], children: [], text: ""};
      stack[stack.length - 1].children.push(node);
      if (!token.endsWith("/>")) stack.push(node);
    } else stack[stack.length - 1].text += decode(token);
  }
  if (stack.length !== 1) throw new Error("Malformed XML");
  return root;
}
export const children = (node: XmlNode, name: string) => node.children.filter(c => c.name === name);
export function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap(c => c.name === name ? [c] : descendants(c, name));
}
export const value = (node: XmlNode, name: string) => descendants(node, name)[0]?.text.trim().replace(/\s+/g, " ") ?? "";
