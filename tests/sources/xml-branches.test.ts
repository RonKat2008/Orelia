import { describe, expect, it } from "vitest";
import { children, descendants, parseXml, value } from "../../lib/sources/xml";

describe("parseXml", () => {
  it("returns an empty root for an empty document", () => {
    expect(parseXml("").children).toEqual([]);
  });
  it("decodes named, decimal and hex entities", () => {
    const root = parseXml("<a>&amp;&lt;&gt;&quot;&apos;&#65;&#x42;</a>");
    expect(value(root, "a")).toBe(`&<>"'AB`);
  });
  it("drops code points beyond the Unicode range", () => {
    expect(value(parseXml("<a>x&#x110000;y</a>"), "a")).toBe("xy");
  });
  it("drops entities whose casing is not a known name", () => {
    expect(value(parseXml("<a>x&AMP;y</a>"), "a")).toBe("xy");
  });
  it("leaves unknown entities untouched and never expands them", () => {
    expect(value(parseXml("<a>&bogus;</a>"), "a")).toBe("&bogus;");
  });
  it("keeps CDATA verbatim, ignoring comments, declarations and processing instructions", () => {
    const root = parseXml('<?xml version="1.0"?><!DOCTYPE x><!-- note --><a><![CDATA[<b>&amp;]]></a>');
    expect(value(root, "a")).toBe("<b>&amp;");
  });
  it("does not push self-closing elements onto the stack", () => {
    const root = parseXml("<a><b/><c>t</c></a>");
    expect(children(descendants(root, "a")[0], "b")).toHaveLength(1);
    expect(value(root, "c")).toBe("t");
  });
  it("tolerates attributes and whitespace in closing tags", () => {
    expect(value(parseXml('<a id="1">x</a >'), "a")).toBe("x");
  });
  it("bubbles child text up into the parent", () => {
    expect(value(parseXml("<a>x<b>y</b>z</a>"), "a")).toBe("xyz");
  });
  it("throws on a closing tag with nothing open", () => {
    expect(() => parseXml("</a>")).toThrow("Malformed XML");
  });
  it("throws on mismatched closing tags", () => {
    expect(() => parseXml("<a><b></a></b>")).toThrow("Malformed XML");
  });
  it("throws on unclosed elements", () => {
    expect(() => parseXml("<a><b>")).toThrow("Malformed XML");
  });
  it("throws on an opening tag without a name", () => {
    expect(() => parseXml("< >")).toThrow("Malformed XML");
  });
});

describe("xml queries", () => {
  it("returns an empty string for missing nodes and collapses whitespace", () => {
    const root = parseXml("<a>  x \n  y </a>");
    expect(value(root, "a")).toBe("x y");
    expect(value(root, "missing")).toBe("");
  });
  it("finds nested descendants but only direct children", () => {
    const root = parseXml("<a><b><c/></b><c/></a>");
    const a = descendants(root, "a")[0];
    expect(descendants(root, "c")).toHaveLength(2);
    expect(children(a, "c")).toHaveLength(1);
  });
});
