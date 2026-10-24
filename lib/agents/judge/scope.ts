/**
 * Hard and soft scope flags, computed in code from code-stamped facts. The judge cannot override them:
 *  - hard (force a drop): pediatric-only, outside the U.S.
 *  - soft (always shown; cap the tier): beyond the travel limit, out-of-state clinician licensure, not recruiting.
 */
import type { CaseInput, ScopeFlag } from "@/lib/contracts";
import { assessAdultScope } from "../pediatric-scope";
import { enrollsAdults, isPediatricFocused } from "../relevance";
import { stateDistanceMiles, toStateCode } from "../research/geo";
import type { RankedEntry } from "../persist";

export const DEFAULT_TRAVEL_MILES = 500;

const fmt = (n: number) => n.toLocaleString("en-US");

/** Code-computed travel facts (state-centroid distance). The judge receives these as given and may not restate others. */
export interface TravelFacts {
  homeState: string;
  nearestState?: string;
  nearestMiles?: number;
  travelLimitMiles: number;
  withinTravelLimit?: boolean;
  beyondLimitMiles?: number;
}

export function travelFacts(home: string | undefined, states: readonly (string | undefined)[], limit: number | undefined): TravelFacts | undefined {
  const homeCode = toStateCode(home);
  if (!home || !homeCode) return undefined;
  const max = limit ?? DEFAULT_TRAVEL_MILES;
  const measured = states
    .map((s) => toStateCode(s))
    .flatMap((code) => {
      const miles = code ? stateDistanceMiles(home, code) : undefined;
      return code && miles !== undefined ? [{ code, miles: Math.round(miles) }] : [];
    })
    .sort((a, b) => a.miles - b.miles);
  const nearest = measured[0];
  if (!nearest) return { homeState: homeCode, travelLimitMiles: max };
  return {
    homeState: homeCode,
    nearestState: nearest.code,
    nearestMiles: nearest.miles,
    travelLimitMiles: max,
    withinTravelLimit: nearest.miles <= max,
    ...(nearest.miles > max ? { beyondLimitMiles: nearest.miles - max } : {}),
  };
}

function travelFlag(home: string | undefined, states: readonly (string | undefined)[], limit: number | undefined): ScopeFlag | undefined {
  const f = travelFacts(home, states, limit);
  if (!f?.beyondLimitMiles) return undefined;
  return { code: "beyond_travel", hard: false, text: `About ${fmt(f.beyondLimitMiles)} mi beyond your ${fmt(f.travelLimitMiles)}-mile travel limit` };
}

/** States a candidate is located or recruiting in (the ones travel is measured to). */
function locationStates(entry: RankedEntry): (string | undefined)[] {
  const r = entry.record.resource;
  if (r.kind === "trial") return [...(r.registry?.recruitingSiteStates ?? [])];
  if (r.kind === "institution") return [r.state];
  if (r.kind === "expert") return [toStateCode(r.profile?.state)];
  return [];
}

/**
 * Given facts for the judge: distance and travel-limit delta, licensure, adult and U.S. scope. All computed in code;
 * the judge may cite these numbers and no other mileage.
 */
export function candidateFacts(entry: RankedEntry, c: Pick<CaseInput, "homeState" | "travelLimitMiles">, flags: readonly ScopeFlag[] = scopeFlags(entry, c)) {
  const r = entry.record.resource;
  const has = (code: ScopeFlag["code"]) => flags.some((f) => f.code === code);
  const travel = r.kind === "organization" ? undefined : travelFacts(c.homeState, locationStates(entry), c.travelLimitMiles);
  const expertState = r.kind === "expert" ? toStateCode(r.profile?.state) : undefined;
  return {
    ...(travel ? { travel } : {}),
    adultScope: has("pediatric_only") ? "children only" : "adults or unstated",
    usScope: has("non_us") ? "outside the U.S." : r.kind === "organization" ? "not location-bound" : "U.S.",
    ...(expertState ? { licensedState: expertState, sameStateAsPatient: !has("out_of_state_license") } : {}),
    ...(r.kind === "trial" && r.registry ? { recruitingInUS: !has("not_recruiting") && !has("non_us") } : {}),
  };
}

export type CandidateFacts = ReturnType<typeof candidateFacts>;

export function scopeFlags(entry: RankedEntry, c: Pick<CaseInput, "homeState" | "travelLimitMiles">): ScopeFlag[] {
  const r = entry.record.resource;
  const flags: ScopeFlag[] = [];
  const push = (f: ScopeFlag | undefined) => f && flags.push(f);
  const texts = entry.record.evidence.map((e) => e.claim);
  switch (r.kind) {
    case "trial": {
      const reg = r.registry;
      if (reg) {
        if (enrollsAdults(reg) === false || isPediatricFocused(r.title, reg)) push({ code: "pediatric_only", hard: true, text: "Registry lists children only; Wayfinder serves adults" });
        if (reg.usSiteCount === 0) push({ code: "non_us", hard: true, text: "No U.S. sites listed in the registry" });
        else if (reg.usRecruitingSiteCount === 0) push({ code: "not_recruiting", hard: false, text: "No U.S. site is marked recruiting" });
        push(travelFlag(c.homeState, reg.recruitingSiteStates, c.travelLimitMiles));
      }
      break;
    }
    case "institution": {
      const adult = assessAdultScope({ name: r.name, texts });
      if (!adult.keep) push({ code: "pediatric_only", hard: true, text: "Children's program with no adult care stated" });
      if (r.state && !toStateCode(r.state)) push({ code: "non_us", hard: true, text: `Located outside the U.S. (${r.state.slice(0, 40)})` });
      push(travelFlag(c.homeState, [r.state], c.travelLimitMiles));
      break;
    }
    case "expert": {
      const adult = assessAdultScope({ name: r.name, specialty: r.specialty, texts });
      if (!adult.keep) push({ code: "pediatric_only", hard: true, text: "Pediatric-only practice with no adult care stated" });
      const state = toStateCode(r.profile?.state);
      push(travelFlag(c.homeState, [state], c.travelLimitMiles));
      if (c.homeState && state && state !== toStateCode(c.homeState)) {
        push({ code: "out_of_state_license", hard: false, text: `Practices in ${state}; telehealth may need a ${toStateCode(c.homeState) ?? c.homeState} license` });
      }
      break;
    }
    case "organization":
      break;
  }
  return flags;
}
