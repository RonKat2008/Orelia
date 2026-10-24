/** Sections of the coordinate page that can hold the page's single primary action, in page order. */
export const SECTION_ORDER = ['requirements', 'packet', 'consult'] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

/** Props every action section takes: whether it holds the page's one primary, and a way to say it needs action. */
export interface SectionFocusProps {
  primary: boolean;
  onNeeds: (needsAction: boolean) => void;
}

/**
 * The first section that needs action. Returns null while an earlier section has not reported yet, so the primary
 * never jumps from a later section to an earlier one when data arrives out of order.
 */
export function firstNeedingAction(needs: Partial<Record<SectionKey, boolean>>): SectionKey | null {
  for (const key of SECTION_ORDER) {
    const value = needs[key];
    if (value === undefined) return null;
    if (value) return key;
  }
  return null;
}
