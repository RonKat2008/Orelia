/**
 * Offline ports for the research-to-care tracer. NPPES reuses the recorded registry responses the research
 * fixtures already ship; Exa is synthetic (example.org pages), so the demo never touches the network.
 * An author with no recorded NPPES response simply degrades to 'unknown'.
 */
import { createFixturePorts } from '@/lib/agents/research/fixture-ports';
import type { ExaPort, ExaResult, NppesPort } from '@/lib/agents/research/source-ports';
import { institutionTokens, slugify } from './affiliation';

const hash = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Synthetic consultation page for most institutions; every third institution has none (exercises 'unknown'). */
export function syntheticConsultPage(institution: string): ExaResult | null {
  if (institutionTokens(institution).length === 0 || hash(institution) % 3 === 0) return null;
  return {
    url: `https://${slugify(institution)}.example.org/second-opinion`,
    title: `${institution} Remote Second Opinion Program`,
    text: `${institution} offers a physician-to-physician e-consultation and remote second opinion program for rare conditions. This is synthetic demo content.`,
  };
}

/** Synthetic provider-profile page, offered only where the institution also has a synthetic consult page. */
export function syntheticClinicPage(person: string, institution: string): ExaResult[] {
  if (!syntheticConsultPage(institution)) return [];
  return [{
    url: `https://${slugify(institution)}.example.org/providers/${slugify(person)}`,
    title: `${person} | ${institution}`,
    text: `${person} sees patients at ${institution}. Request an appointment. This is synthetic demo content.`,
  }];
}

export function createFixtureExpertPorts(root?: string): { nppes: NppesPort; exa: ExaPort } {
  const base = createFixturePorts(root ? { root } : {});
  const exa: ExaPort = {
    async search({ query }) {
      const institution = /^"([^"]+)" second opinion/.exec(query)?.[1];
      if (institution) {
        const page = syntheticConsultPage(institution);
        return page ? [page] : [];
      }
      const clinic = /^"([^"]+)" "([^"]+)" appointments patients/.exec(query);
      return clinic ? syntheticClinicPage(clinic[1]!, clinic[2]!) : [];
    },
  };
  return { nppes: base.nppes, exa };
}
