import { STATE_NAMES } from "@/lib/agents/research/geo";

const TERRITORIES: Record<string, string> = {
  "puerto rico": "PR",
  guam: "GU",
  "u.s. virgin islands": "VI",
  "american samoa": "AS",
  "northern mariana islands": "MP",
};

const BY_NAME = new Map<string, string>([
  ...Object.entries(STATE_NAMES).map(([name, code]) => [name.toLowerCase(), code] as const),
  ...Object.entries(TERRITORIES),
]);
const CODES = new Set(BY_NAME.values());

/** "az", " Arizona " -> "AZ". Anything that is not a US state, DC or territory -> undefined. */
export function normalizeUsState(value: string): string | undefined {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (CODES.has(upper)) return upper;
  return BY_NAME.get(trimmed.toLowerCase().replace(/\s+/g, " "));
}
