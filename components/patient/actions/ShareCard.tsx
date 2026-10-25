"use client";

import { ConsentChecklist } from "../flows/consent/ConsentChecklist";
import type { ActionProps } from "./ActionFrame";

/**
 * Consent on the case home: the one-screen checklist inside the ActionCard. One set of choices is saved for
 * every picked person without saved consent; only what the patient says yes to is ever shared.
 */
export function ShareCard({ caseId, onDone, detailsHref }: ActionProps & { detailsHref: string; headline?: string }) {
  return <ConsentChecklist caseId={caseId} layout="card" detailsHref={detailsHref} onSaved={onDone} />;
}
