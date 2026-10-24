import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNciCenters, matchNciCenters, type NciCenter, type NciDataset } from "../../lib/sources/nci-centers";

const GEN = "2026-01-01T00:00:00.000Z";
const center = (name: string, over: Partial<NciCenter> = {}): NciCenter =>
  ({ name, city: "Springfield", state: "ZZ", designation: "Comprehensive", url: `https://example.test/${encodeURIComponent(name)}`, ...over });
const dataset = (centers: NciCenter[]): NciDataset => ({ source_url: "https://example.test/src", generated_at: GEN, centers });

describe("loadNciCenters", () => {
  let dir = "";
  const write = async (name: string, content: unknown) => { const p = join(dir, name); await writeFile(p, typeof content === "string" ? content : JSON.stringify(content)); return p; };
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "wf-nci-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("loads the bundled dataset by default", async () => {
    const data = await loadNciCenters();
    expect(data.centers.length).toBeGreaterThan(0);
  });
  it("loads a valid dataset from a custom path", async () => {
    expect((await loadNciCenters(await write("ok.json", dataset([center("Alpha Beta Center")])))).centers).toHaveLength(1);
  });
  it.each([
    ["centers not an array", { ...dataset([]), centers: "x" }],
    ["missing source_url", { ...dataset([]), source_url: "" }],
    ["invalid generated_at", { ...dataset([]), generated_at: "yesterday" }],
    ["center without name", dataset([center("", {})])],
    ["center without url", dataset([center("A B", { url: "" })])],
    ["center without designation", dataset([center("A B", { designation: "" })])],
  ])("rejects an invalid dataset: %s", async (n, content) => {
    await expect(loadNciCenters(await write(`${n.replace(/\W/g, "_")}.json`, content))).rejects.toThrow("Invalid center dataset");
  });
  it("propagates malformed JSON and missing files", async () => {
    await expect(loadNciCenters(await write("bad.json", "{nope"))).rejects.toThrow(SyntaxError);
    await expect(loadNciCenters(join(dir, "absent.json"))).rejects.toThrow(/ENOENT/);
  });
});

describe("matchNciCenters", () => {
  it("returns nothing for an empty dataset or unrelated text", () => {
    expect(matchNciCenters("Anywhere", dataset([]))).toEqual({ records: [], evidence: [] });
  });
  it("matches an exact normalized center name regardless of accents and punctuation", () => {
    const res = matchNciCenters("Dept. of Medicine, Zürich-Alpha Béta Cancer Center, Springfield", dataset([center("Zurich Alpha Beta Cancer Center")]));
    expect(res.records).toHaveLength(1);
    expect(res.records[0].matchScore).toBe(1);
  });
  it("matches a high-overlap partial name with at least two distinctive tokens", () => {
    const res = matchNciCenters("Alpha Beta Gamma Delta Center", dataset([center("Alpha Beta Gamma Delta Epsilon Cancer Center")]));
    expect(res.records[0].matchScore).toBe(0.8);
  });
  it("rejects a single shared distinctive token", () => {
    expect(matchNciCenters("Visiting Alpha clinic", dataset([center("Alpha Beta Cancer Center")])).records).toEqual([]);
  });
  it("rejects single-token center names that are not an exact phrase match", () => {
    expect(matchNciCenters("Alpha clinic", dataset([center("Alpha Cancer Center")])).records).toEqual([]);
  });
  it("accepts a single-token center name only on an exact phrase match", () => {
    expect(matchNciCenters("Dept of X, Alpha Cancer Center, Y", dataset([center("Alpha Cancer Center")])).records).toHaveLength(1);
  });
  it("ignores centers whose names contain only generic words", () => {
    expect(matchNciCenters("The University Cancer Center", dataset([center("The University Cancer Center")])).records).toEqual([]);
  });
  it("rejects overlap below the 0.8 threshold", () => {
    expect(matchNciCenters("Alpha Beta", dataset([center("Alpha Beta Gamma Delta Epsilon Zeta")])).records).toEqual([]);
  });
  it("sorts by score then name and builds evidence with caveat", () => {
    const res = matchNciCenters("Alpha Beta Gamma Delta Epsilon Center; Alpha Beta Zed Cancer Center; Alpha Beta Aaa Cancer Center", dataset([
      center("Alpha Beta Zed Cancer Center"),
      center("Alpha Beta Aaa Cancer Center"),
      center("Alpha Beta Gamma Delta Epsilon Zeta Center"),
    ]));
    expect(res.records.map(r => r.name)).toEqual(["Alpha Beta Aaa Cancer Center", "Alpha Beta Zed Cancer Center", "Alpha Beta Gamma Delta Epsilon Zeta Center"]);
    expect(res.evidence[0]).toMatchObject({ sourceKind: "nci", fetchedAt: GEN, claimType: "nci_designation" });
    expect(res.evidence[0].claim).toContain("candidate, not verified employment");
  });
  it("orders equal-score centers alphabetically regardless of dataset order", () => {
    const names = ["Alpha Beta Aaa Cancer Center", "Alpha Beta Mmm Cancer Center", "Alpha Beta Zed Cancer Center"];
    const text = names.join("; ");
    for (const order of [names, [...names].reverse()]) {
      expect(matchNciCenters(text, dataset(order.map(n => center(n)))).records.map(r => r.name)).toEqual(names);
    }
  });
  it("keeps duplicate-name centers in stable order", () => {
    const res = matchNciCenters("Alpha Beta Cancer Center", dataset([center("Alpha Beta Cancer Center", { city: "One" }), center("Alpha Beta Cancer Center", { city: "Two" })]));
    expect(res.records.map(r => r.city)).toEqual(["One", "Two"]);
  });
});
