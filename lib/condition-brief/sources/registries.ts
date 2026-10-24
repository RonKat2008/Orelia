/**
 * Condition Brief collector: patient / natural-history registries found by an open Exa search.
 * Only pages that mention a registry and name the disease are kept. Never throws.
 */
import { cleanField, neutralizeUntrusted } from "@/lib/agents/research/untrusted";
import type { BriefSource, RegistryItem } from "../contract";
import { exaSearch, namesDisease, parseHttpUrl, sha8 } from "./reference";
import type { Collector } from "./types";

export const REGISTRY_FILE = "registry-exa.json";
const NUM_RESULTS = 8;
const MAX_REGISTRIES = 5;
const EXA_TEXT_CHARS = 4000;
const EXCERPT_CAP = 2000;
const DESCRIPTION_CAP = 400;
const NAME_CAP = 200;
const REGISTRY_WORD = /\bregistr(?:y|ies)\b/i;
// Papers and trial records that merely mention a registry are not registry pages (trials are another collector's).
const EXCLUDED_HOSTS = new Set(["pubmed.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov", "doi.org", "dx.doi.org"]);
const CTGOV_MIRROR = /(^|\.)clinicaltrials\./;

export function registryBody(disease: string) {
  return {
    query: `${disease} patient registry`,
    numResults: NUM_RESULTS,
    contents: { text: { maxCharacters: EXA_TEXT_CHARS } },
  };
}

function registrySentence(text: string): string | undefined {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => REGISTRY_WORD.test(s));
  return hit?.slice(0, DESCRIPTION_CAP).trim() || undefined;
}

export const collectRegistries: Collector = async (diseaseName, ctx) => {
  if (!ctx.offline && !ctx.exaApiKey) {
    return { errors: [{ source: "registry", message: "Registry search is not configured" }] };
  }
  let found;
  try {
    found = await exaSearch(ctx, registryBody(diseaseName), REGISTRY_FILE);
  } catch {
    return { errors: [{ source: "registry", message: "Registry search failed" }] };
  }
  const sources: BriefSource[] = [];
  const registries: RegistryItem[] = [];
  const seen = new Set<string>();
  for (const r of found.results) {
    if (registries.length >= MAX_REGISTRIES) break;
    const url = parseHttpUrl(r.url);
    if (!url || EXCLUDED_HOSTS.has(url.hostname) || CTGOV_MIRROR.test(url.hostname) || seen.has(url.href)) continue;
    const title = cleanField(r.title ?? undefined) ?? "";
    const text = neutralizeUntrusted(r.text ?? "");
    if (!REGISTRY_WORD.test(`${title} ${text}`)) continue;
    if (!namesDisease(`${title} ${text}`, diseaseName)) continue;
    seen.add(url.href);
    const name = (title || url.hostname).slice(0, NAME_CAP);
    const id = `web:${sha8(url.href)}`;
    const excerpt = text.slice(0, EXCERPT_CAP);
    sources.push({
      id, kind: "registry", design: "registry", url: url.href, title: name,
      publisher: url.hostname, fetchedAt: found.fetchedAt, excerpt: excerpt || undefined,
    });
    registries.push({ sourceId: id, name, url: url.href, description: registrySentence(text) });
  }
  return { sources, registries, errors: [] };
};
