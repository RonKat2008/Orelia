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

function travelFlag(home: string | undefined, states: readonly (string | undefined)[], limit: number | undefined): ScopeFlag | undefined {
  if (!home) return undefined;
  const miles = states.map((s) => stateDistanceMiles(home, toStateCode(s))).filter((m): m is number => m !== undefined);
  if (miles.length === 0) return undefined;
  const nearest = Math.min(...miles);
  const max = limit ?? DEFAULT_TRAVEL_MILES;
  if (nearest <= max) return undefined;
  return { code: "beyond_travel", hard: false, text: `About ${fmt(nearest - max)} mi beyond your ${fmt(max)}-mile travel limit` };
}

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
