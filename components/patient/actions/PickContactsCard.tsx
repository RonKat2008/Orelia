"use client";

import { ShortlistPicker } from "../flows/shortlist/ShortlistPicker";
import type { ActionProps } from "./ActionFrame";

/** Choosing who we contact, on the case home: the patient shortlist inside the one ActionCard. */
export function PickContactsCard({ caseId, onDone, detailsHref }: ActionProps & { detailsHref: string; headline?: string }) {
  return <ShortlistPicker caseId={caseId} layout="card" detailsHref={detailsHref} onDone={onDone} />;
}
