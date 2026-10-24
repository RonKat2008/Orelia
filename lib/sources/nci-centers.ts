import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SourceError } from "./transport";
import { evidence, type SourceResult } from "./types";
export interface NciCenter {name: string; city: string; state: string; designation: string; url: string}
export interface NciDataset {source_url: string; generated_at: string; centers: NciCenter[]}
export async function loadNciCenters(path = resolve(process.cwd(),"data/nci-centers.json")): Promise<NciDataset> {
  const data = JSON.parse(await readFile(path,"utf8")) as NciDataset;
  if (!Array.isArray(data.centers) || !data.source_url || !Number.isFinite(Date.parse(data.generated_at)) || data.centers.some(c => !c.name || !c.url || !c.designation)) throw new SourceError("nci", "Invalid center dataset");
  return data;
}
const normalize = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g," ").trim();
const generic = new Set(["the","of","at","and","in","university","cancer","center","centre","comprehensive","institute","medical","hospital","school","health"]);
const tokens = (s: string) => normalize(s).split(" ").filter(t => t.length > 1 && !generic.has(t));
export function matchNciCenters(affiliation: string, dataset: NciDataset): SourceResult<NciCenter & {matchScore:number}> {
  const normalized = ` ${normalize(affiliation)} `;
  const affiliationTokens = new Set(tokens(affiliation));
  const records = dataset.centers.flatMap(center => {
    const distinct = tokens(center.name);
    if (!distinct.length) return [];
    const overlap = distinct.filter(t => affiliationTokens.has(t)).length;
    const exact = normalized.includes(` ${normalize(center.name)} `);
    const score = exact ? 1 : overlap / distinct.length;
    // A single generic location/name fragment is insufficient evidence of affiliation.
    return exact || (distinct.length >= 2 && overlap >= 2 && score >= 0.8) ? [{...center,matchScore:score}] : [];
  }).sort((a,b) => b.matchScore-a.matchScore || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {records,evidence:records.map(c => evidence("nci",c.url,dataset.generated_at,"nci_designation",`${c.name} — ${c.designation}, ${c.city}, ${c.state}. Affiliation text match is a candidate, not verified employment.`))};
}
