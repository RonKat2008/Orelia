/**
 * Patient view / Judge view switch. Pure helpers: the URL (?view=) wins so judges can share a link, then the
 * viewer's stored choice, then the patient view. Both views read the same case data and routes.
 */
export type ViewMode = "patient" | "judge";

export const VIEW_MODES: readonly ViewMode[] = ["patient", "judge"];
export const DEFAULT_VIEW: ViewMode = "patient";
export const VIEW_PARAM = "view";
export const VIEW_STORAGE_KEY = "wayfinder.view";

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

export function parseView(value: string | null | undefined): ViewMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "patient" || normalized === "judge" ? normalized : null;
}

export function viewFromSearch(search: string): ViewMode | null {
  try {
    return parseView(new URLSearchParams(search).get(VIEW_PARAM));
  } catch {
    return null;
  }
}

export function resolveView({ search, stored }: { search: string; stored: string | null }): ViewMode {
  return viewFromSearch(search) ?? parseView(stored) ?? DEFAULT_VIEW;
}

export function readStoredView(storage: ReadStorage): ViewMode | null {
  try {
    return parseView(storage.getItem(VIEW_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredView(view: ViewMode, storage: WriteStorage): void {
  try {
    storage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Blocked storage: the URL still carries the choice for this visit.
  }
}

/** Same path, with ?view= set (other params and the hash kept). */
export function urlWithView(href: string, view: ViewMode): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = beforeHash.indexOf("?");
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "");
  params.set(VIEW_PARAM, view);
  return `${path}?${params.toString()}${hash}`;
}

const CASE_SUBPAGE = /^\/cases\/([^/?#]+)\/[^?#]+/;

/**
 * Where the toggle goes. The patient view has one simple case home, so a patient on a detailed case sub-page
 * lands on it; every other switch keeps the page.
 */
export function hrefForView(pathname: string, view: ViewMode): string {
  const sub = CASE_SUBPAGE.exec(pathname);
  if (view === "patient" && sub) return urlWithView(`/cases/${sub[1]}`, view);
  return urlWithView(pathname, view);
}
