import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BriefDocument } from "@/components/condition-brief/BriefDocument";
import { BriefHeader } from "@/components/condition-brief/BriefHeader";
import { buildBrief, getBrief } from "@/components/condition-brief/client";
import { LevelLegend } from "@/components/condition-brief/LevelLegend";
import {
  chipAriaLabel,
  ceilingFor,
  filterStatements,
  indexSources,
  levelCounts,
  QUESTIONS_FRAMING,
  safeHref,
  type LevelFilter,
} from "@/components/condition-brief/model";
import { SourceChips } from "@/components/condition-brief/SourceChips";
import { SourceDetails } from "@/components/condition-brief/SourceDrawer";
import { MotionPreference } from "@/lib/motion/MotionPreference";
import { conditionBriefSchema, type BriefSource } from "@/lib/condition-brief/contract";
import { emptyBrief, sampleBrief } from "./sample-brief";

const noop = () => {};

function doc(level: LevelFilter, brief = sampleBrief, reduced = false) {
  return renderToStaticMarkup(
    createElement(MotionPreference, { reducedMotion: reduced }, createElement(BriefDocument, { brief, level, onOpenSource: noop })),
  );
}

describe("fixture", () => {
  it("passes the contract schema", () => {
    expect(conditionBriefSchema.safeParse(sampleBrief).success).toBe(true);
    expect(conditionBriefSchema.safeParse(emptyBrief).success).toBe(true);
  });
});

describe("level filtering", () => {
  it("shows everything for All", () => {
    const html = doc("all");
    expect(html).toContain("ESTABLISHED-MECH");
    expect(html).toContain("EMERGING-GEN");
    expect(html).toContain("UNCERTAIN-NAT");
  });
  it.each([
    ["established", "ESTABLISHED-MECH", ["EMERGING-GEN", "UNCERTAIN-NAT"]],
    ["emerging", "EMERGING-GEN", ["ESTABLISHED-MECH", "UNCERTAIN-NAT"]],
    ["uncertain", "UNCERTAIN-NAT", ["ESTABLISHED-MECH", "EMERGING-GEN"]],
  ] as const)("keeps only %s statements", (level, keep, drop) => {
    const html = doc(level);
    expect(html).toContain(keep);
    for (const d of drop) expect(html).not.toContain(d);
  });
  it("filters studies, trials and prevalence by level", () => {
    const established = doc("established");
    expect(established).toContain("1-9 / 1 000 000"); // Orphanet reference page -> established
    expect(established).not.toContain("Phase 1 study of a synthetic compound");
    const emerging = doc("emerging");
    expect(emerging).toContain("Phase 1 study of a synthetic compound");
    expect(emerging).not.toContain("1-9 / 1 000 000");
  });
  it("says so calmly when a filter empties a section", () => {
    expect(doc("uncertain")).toContain("Nothing at this level in this section.");
  });
  it("counts levels for the legend", () => {
    const c = levelCounts(sampleBrief);
    expect(c.all).toBe(c.established + c.emerging + c.uncertain);
    expect(c.established).toBeGreaterThan(0);
  });
  it("filterStatements respects sections", () => {
    expect(filterStatements(sampleBrief.statements, ["genetics"], "all").map((s) => s.id)).toEqual(["st-gen"]);
  });
  it("ceilingFor takes the best cited source", () => {
    const idx = indexSources(sampleBrief.sources);
    expect(ceilingFor(["pubmed:100002", "genereviews:NBK000001"], idx)).toBe("established");
    expect(ceilingFor(["unknown"], idx)).toBe("uncertain");
  });
});

describe("sections and content", () => {
  it("renders six labelled sections in order", () => {
    const html = doc("all");
    const ids = ["brief-rarity", "brief-known", "brief-studies", "brief-research", "brief-registries", "brief-questions"];
    let last = -1;
    for (const id of ids) {
      expect(html).toContain(`aria-labelledby="${id}"`);
      const at = html.indexOf(`id="${id}"`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(html).not.toContain("<main");
  });
  it("shows trial status, phase, sponsor and study journal and year", () => {
    const html = doc("all");
    expect(html).toContain("recruiting");
    expect(html).toContain("PHASE1");
    expect(html).toContain("Example University");
    expect(html).toContain("Journal of Synthetic Medicine, 2021");
  });
  it("renders the empty line in every empty section", () => {
    const html = doc("all", emptyBrief);
    expect(html.split("Nothing found in the sources we checked.").length - 1).toBe(6);
  });
  it("frames questions as questions, with no advice wording", () => {
    const html = doc("all");
    expect(html).toContain(QUESTIONS_FRAMING);
    expect(QUESTIONS_FRAMING).toBe("Questions you might bring to your care team. Wayfinder does not give medical advice.");
    for (const q of sampleBrief.questions) expect(q.text.endsWith("?")).toBe(true);
    const copy = html.replace(/<[^>]+>/g, " ");
    expect(copy).not.toMatch(/\byou should\b|\bwe recommend\b|\bwe advise\b|\btake this\b|\bstart taking\b/i);
  });
  it("links registries safely", () => {
    const html = doc("all");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });
  it("is identical in structure under reduced motion", () => {
    expect(doc("all", sampleBrief, true)).toContain("ESTABLISHED-MECH");
  });
});

describe("evidence markers and chips", () => {
  it("shows a worded evidence marker on every statement", () => {
    const html = doc("all");
    expect(html).toContain("Established");
    expect(html).toContain("Emerging");
    expect(html).toContain("Uncertain");
    expect(html).toContain('data-level="established"');
  });
  it("names chips with number, kind, design and year", () => {
    const src = sampleBrief.sources[1];
    expect(chipAriaLabel(2, src)).toBe("Source 2: PubMed review, 2021");
    expect(doc("all")).toContain('aria-label="Source 2: PubMed review, 2021"');
    expect(chipAriaLabel(1, sampleBrief.sources[0])).toBe("Source 1: Orphanet, 2024");
  });
  it("opens the drawer: clicking a chip hands its source to onOpen", () => {
    const onOpen = vi.fn();
    const tree = SourceChips({ sourceIds: ["pubmed:100001"], index: indexSources(sampleBrief.sources), onOpen }) as ReactElement;
    const findButton = (node: unknown): { onClick: () => void } | null => {
      if (!node || typeof node !== "object") return null;
      const el = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
      if (el.type === "button" && el.props?.onClick) return { onClick: el.props.onClick };
      const kids = el.props?.children;
      for (const k of Array.isArray(kids) ? kids : [kids]) {
        const found = findButton(k);
        if (found) return found;
      }
      return null;
    };
    const btn = findButton(tree);
    expect(btn).not.toBeNull();
    btn?.onClick();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "pubmed:100001" }));
  });
});

describe("source details", () => {
  const html = (s: BriefSource) => renderToStaticMarkup(createElement(SourceDetails, { source: s }));
  it("shows kind, publisher, year, fetched date, design label and an outbound link", () => {
    const out = html(sampleBrief.sources[1]);
    expect(out).toContain("PubMed");
    expect(out).toContain("Journal of Synthetic Medicine");
    expect(out).toContain("2021");
    expect(out).toContain("Oct 20, 2026");
    expect(out).toContain("A review article");
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="https://pubmed.ncbi.nlm.nih.gov/100001/"');
  });
  it("renders excerpts as escaped plain text", () => {
    const out = html(sampleBrief.sources[0]);
    expect(out).toContain("&lt;b&gt;1-9 / 1 000 000&lt;/b&gt;");
    expect(out).not.toContain("<b>");
  });
  it("omits the link for non-http urls", () => {
    const out = html({ ...sampleBrief.sources[0], url: "javascript:alert(1)" });
    expect(out).not.toContain("<a ");
  });
});

describe("legend and header", () => {
  const legend = (value: LevelFilter, reduced = false) =>
    renderToStaticMarkup(
      createElement(MotionPreference, { reducedMotion: reduced }, createElement(LevelLegend, { value, onChange: noop })),
    );
  it("is a radiogroup with four options and the active one checked", () => {
    const out = legend("emerging");
    expect(out).toContain('role="radiogroup"');
    expect((out.match(/role="radio"/g) ?? []).length).toBe(4);
    expect(out).toMatch(/aria-checked="true"[^>]*>(?:<[^>]*>)*Emerging/);
  });
  it("explains each level in one sentence", () => {
    const out = legend("all");
    expect(out).toContain("guidelines, systematic reviews, consensus statements, GeneReviews or curated reference pages");
    expect(out).toContain("single studies, early trials or funded projects");
    expect(out).toContain("case reports or limited sources");
  });
  it("renders without the animated pill under reduced motion", () => {
    expect(legend("emerging", true)).toContain("bg-teal");
  });
  const header = (b = sampleBrief) =>
    renderToStaticMarkup(createElement(BriefHeader, { brief: b, busy: false, onRefresh: noop }));
  it("uses an h2 under the case layout's single h1, with the shared uppercase eyebrow", () => {
    const out = header();
    expect(out).not.toContain("<h1");
    expect(out).toMatch(/<h2[^>]*>What the public sources say about/);
    expect(out).toMatch(/<p class="[^"]*uppercase[^"]*">Condition brief<\/p>/);
  });
  it("shows disease, date, offline badge and dropped count", () => {
    const out = header();
    expect(out).toContain("Synthetic Example Syndrome");
    expect(out).toContain("Generated Oct 20, 2026");
    expect(out).toContain("Recorded sources");
    expect(out).toContain("2 items removed by our source check");
    expect(out).toContain("Refresh");
  });
  it("hides badge and note when live with nothing dropped", () => {
    const out = header(emptyBrief);
    expect(out).not.toContain("Recorded sources");
    expect(out).not.toContain("removed by our source check");
  });
});

describe("client", () => {
  const res = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  it("returns null brief on 404 for GET", async () => {
    const f = vi.fn(() => res(404, { error: "none" }));
    expect(await getBrief("c1", f as unknown as typeof fetch)).toEqual({ ok: true, brief: null });
  });
  it("GET asks optionally and reads 200 { brief: null } as 'none yet'", async () => {
    const f = vi.fn((url: string) => { void url; return res(200, { brief: null }); });
    expect(await getBrief("c1", f as unknown as typeof fetch)).toEqual({ ok: true, brief: null });
    expect(f.mock.calls[0][0]).toBe("/api/cases/c1/condition-brief?optional=1");
  });
  it("validates the response with the schema", async () => {
    const good = await getBrief("c1", (() => res(200, { brief: sampleBrief })) as unknown as typeof fetch);
    expect(good.ok && good.brief?.diseaseName).toBe("Synthetic Example Syndrome");
    const bad = await getBrief("c1", (() => res(200, { brief: { nope: 1 } })) as unknown as typeof fetch);
    expect(bad).toMatchObject({ ok: false, status: 502 });
  });
  it("POSTs the refresh flag and surfaces the error envelope", async () => {
    const f = vi.fn((...args: [string, RequestInit?]) => (args.length ? res(500, { error: "Boom" }) : res(500, {})));
    const r = await buildBrief("c1", true, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, status: 500, message: "Boom" });
    expect(f.mock.calls[0][0]).toBe("/api/cases/c1/condition-brief");
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ refresh: true });
    expect(f.mock.calls[0][1]?.method).toBe("POST");
  });
  it("treats a POST 404 as an error, not as 'no brief'", async () => {
    const r = await buildBrief("c1", false, (() => res(404, {})) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
  it("reports network failure", async () => {
    const r = await getBrief("c1", (() => Promise.reject(new Error("x"))) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 0 });
  });
});
