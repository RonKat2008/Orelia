/** Small US geography helpers shared by the fixture ports, live ports and ranking signals. */

export const STATE_NAMES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI",
  Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  "District of Columbia": "DC",
};

const STATE_CODES = new Set(Object.values(STATE_NAMES));

/** Approximate geographic centroids (lat, lon). Distances between them are coarse by design. */
const CENTROIDS: Record<string, readonly [number, number]> = {
  AL: [32.8, -86.8], AK: [64.2, -149.5], AZ: [34.3, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.5],
  CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4],
  GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3],
  IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2],
  MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7],
  MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
  NJ: [40.1, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.1, -72.7], VA: [37.5, -78.8], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.9],
  WY: [43.0, -107.5],
};

const EARTH_RADIUS_MILES = 3958.8;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle miles between two states' centroids; 0 for the same state; undefined if either is unknown. */
export function stateDistanceMiles(a: string | undefined, b: string | undefined): number | undefined {
  const from = a ? CENTROIDS[a.toUpperCase()] : undefined;
  const to = b ? CENTROIDS[b.toUpperCase()] : undefined;
  if (!a || !b || !from || !to) return undefined;
  if (a.toUpperCase() === b.toUpperCase()) return 0;
  const dLat = rad(to[0] - from[0]);
  const dLon = rad(to[1] - from[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from[0])) * Math.cos(rad(to[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h)));
}

/** Two-letter state parsed from free-text affiliation, if present. */
export function stateFromAffiliation(text: string): string | undefined {
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`(?:,|\\s)${name}(?:[,.;\\s]|$)`).test(text)) return code;
  }
  const abbreviation = /,\s([A-Z]{2})(?:\s\d{5})?[,.]?(?:\s|$)/.exec(text);
  return abbreviation && STATE_CODES.has(abbreviation[1] ?? "") ? abbreviation[1] : undefined;
}

export const CANCER_WORDS = /sarcoma|cancer|carcinoma|lymphoma|leukemia|tumor|melanoma/i;

/** "Massachusetts" or "MA" -> "MA". Unknown input is returned upper-cased if two letters, else undefined. */
export function toStateCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (STATE_NAMES[trimmed]) return STATE_NAMES[trimmed];
  const upper = trimmed.toUpperCase();
  return STATE_CODES.has(upper) ? upper : undefined;
}
