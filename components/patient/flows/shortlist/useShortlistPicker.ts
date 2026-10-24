"use client";

import { useEffect, useState } from "react";
import { initialSelection, loadShortlist, type ShortlistCard } from "@/components/shortlist/data";
import { selectOutreach, writeStoredOutreach } from "@/components/outreach/client";
import { loadCaseContacts, loadShortlistNames, withDisplayNames } from "@/components/outreach/case-activity";
import { loadNeedsJudge } from "@/components/judge/client";
import type { JudgeResult } from "@/lib/contracts/judge";
import { toast } from "@/components/ui";
import { SHORTLIST_COPY as COPY } from "./copy";
import { PICK_LIMIT, orderCards, togglePick } from "./logic";

const SELECTED_KEY = (caseId: string) => `wayfinder.selected.${caseId}`;

function readStored(caseId: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(SELECTED_KEY(caseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(caseId: string, ids: string[]) {
  try {
    sessionStorage.setItem(SELECTED_KEY(caseId), JSON.stringify(ids));
  } catch {
    // Selection still works for this visit.
  }
}

export interface LoadedShortlist {
  cards: ShortlistCard[];
  suggested: string[];
  error: string | null;
}

export interface ShortlistPicker {
  loaded: LoadedShortlist | null;
  judge: JudgeResult | null;
  selected: string[];
  busy: boolean;
  errors: string[];
  toggle: (key: string) => void;
  /** Validates (at least 1), then saves with the same select call as before. Resolves true on success. */
  submit: () => Promise<boolean>;
}

/** Load the shortlist, keep the picks (session storage, as before) and add the picks as contacts. Nothing is sent. */
export function useShortlistPicker(caseId: string): ShortlistPicker {
  const [loaded, setLoaded] = useState<LoadedShortlist | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [judge, setJudge] = useState<JudgeResult | null>(null);

  useEffect(() => {
    let active = true;
    void loadNeedsJudge(caseId).then((r) => {
      if (active && r.ok) setJudge(r.judge);
    });
    void loadShortlist(caseId).then((result) => {
      if (!active) return;
      const suggested = result.payload.suggested;
      setLoaded({ cards: orderCards(result.payload.items, suggested), suggested, error: result.error });
      setSelected(initialSelection(readStored(caseId), suggested, PICK_LIMIT));
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  function toggle(key: string) {
    setErrors([]);
    setSelected((current) => {
      const next = togglePick(current, key);
      writeStored(caseId, next);
      return next;
    });
  }

  async function submit(): Promise<boolean> {
    if (selected.length === 0) {
      setErrors([COPY.noneChosen]);
      return false;
    }
    setBusy(true);
    setErrors([]);
    writeStored(caseId, selected);
    const result = await selectOutreach(caseId, selected);
    if (!result.ok) {
      setBusy(false);
      setErrors(result.reasons);
      toast.error(COPY.failToast, { description: COPY.failToastDetail });
      return false;
    }
    const [live, names] = await Promise.all([loadCaseContacts(caseId), loadShortlistNames(caseId)]);
    writeStoredOutreach(caseId, {
      contacts: withDisplayNames(result.value.contacts, live),
      unavailable: result.value.unavailable.map((item) => (names.has(item.candidateId) ? { ...item, name: names.get(item.candidateId) } : item)),
    });
    const skipped = result.value.unavailable.length;
    toast.success(COPY.toast(result.value.contacts.length), {
      description: skipped > 0 ? COPY.toastSkipped(skipped) : COPY.toastDetail,
    });
    setBusy(false);
    return true;
  }

  return { loaded, judge, selected, busy, errors, toggle, submit };
}
