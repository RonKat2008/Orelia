"use client";

import { useEffect, useState } from "react";
import { loadCase, type ApiContact } from "@/components/outreach/client";
import { loadCaseContacts } from "@/components/outreach/case-activity";
import type { CaseInput } from "@/lib/contracts";

export interface ConsentTargets {
  record: CaseInput | null;
  /** People picked for this case. */
  total: number;
  /** Only people without saved choices: anyone already set up keeps exactly what was chosen for them. */
  people: ApiContact[];
}

async function consentedIds(caseId: string): Promise<Set<string>> {
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/contacts`);
    const body = (await response.json()) as { contacts?: { id?: unknown; consented?: unknown }[] };
    return new Set((body.contacts ?? []).flatMap((c) => (c.consented === true && typeof c.id === "string" ? [c.id] : [])));
  } catch {
    return new Set();
  }
}

/** The case details and the people who still need consent (same calls ShareCard always made). */
export function useConsentTargets(caseId: string): ConsentTargets | null {
  const [targets, setTargets] = useState<ConsentTargets | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([loadCase(caseId), loadCaseContacts(caseId), consentedIds(caseId)]).then(([record, contacts, consented]) => {
      if (!active) return;
      const all = contacts ?? [];
      setTargets({ record, total: all.length, people: all.filter((c) => !consented.has(c.id)) });
    });
    return () => {
      active = false;
    };
  }, [caseId]);
  return targets;
}
