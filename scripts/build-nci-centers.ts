// Builds data/nci-centers.json from the cancer.gov "find" page.
// Usage: node --experimental-strip-types scripts/build-nci-centers.ts <saved-find.html>
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "https://www.cancer.gov/research/infrastructure/cancer-centers/find";
const html = readFileSync(process.argv[2] /* path to a saved copy of the cancer.gov find page */, "utf8");
const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;/g, "’").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " "));
const STATES: Record<string, string> = JSON.parse(
  '{"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","District of Columbia":"DC","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"}',
);
const DESIGNATIONS = ["Clinical Cancer Center", "Comprehensive Cancer Center", "Basic Laboratory Cancer Center", "Cancer Center"];

type Center = { name: string; designation: string | null; city: string | null; state: string | null; url: string | null };
const centers: Center[] = [];
const seen = new Set<string>();
const re = /<p>(<a href="\/research\/infrastructure\/cancer-centers\/find\/.*?)<\/p>/g;
let m: RegExpExecArray | null;
while ((m = re.exec(html))) {
  const p = m[1];
  const a = /<a href="([^"]+)"[^>]*>(.*?)<\/a>/.exec(p);
  if (!a) continue;
  const url = new URL(a[1], "https://www.cancer.gov").href;
  if (seen.has(url)) continue;
  seen.add(url);
  const strong = /<strong>(.*?)<\/strong>/.exec(p);
  const loc = strong ? strip(strong[1]) : "";
  const lm = /^(.*?),\s*(.+)$/.exec(loc);
  const stateName = lm ? lm[2].replace("Hawai'i", "Hawaii") : "";
  const text = strip(p.replace(/<br\s*\/?>/g, " | "));
  const designation = DESIGNATIONS.find((d) => text.endsWith(d)) ?? null;
  centers.push({
    name: strip(a[2]),
    designation,
    city: lm ? lm[1] : null,
    state: STATES[stateName] ?? null,
    url,
  });
}
centers.sort((x, y) => x.name.localeCompare(y.name));
writeFileSync(
  "data/nci-centers.json",
  JSON.stringify(
    {
      source_url: SOURCE,
      generated_at: new Date().toISOString(),
      method: "Fetched the cancer.gov find page with curl and parsed each state-grouped list entry (name, location, designation, profile link) from its HTML, de-duplicated by profile URL.",
      centers,
    },
    null,
    2,
  ) + "\n",
);
console.log(centers.length);
