"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Button, Checkbox, IconButton, Input, Label, toast } from "@/components/ui";
import { prepItemsFor } from "@/lib/appointments/prep-items";
import type { PrepNotes } from "@/lib/appointments/schema";
import { savePrep } from "./client";
import type { ApptView } from "./model";

/**
 * Practical prep only. The checklist is fixed, non-clinical items; "My questions" holds the patient's own words.
 * Wayfinder never suggests medical questions or advice here.
 */
export function PrepChecklist({ id, appointment, onChange }: { id: string; appointment: ApptView; onChange: (next: ApptView) => void }) {
  const [prep, setPrep] = useState<PrepNotes>(appointment.prepNotes);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const items = prepItemsFor(appointment);

  async function persist(next: PrepNotes) {
    setPrep(next);
    setSaving(true);
    const result = await savePrep(appointment.id, next);
    setSaving(false);
    if (!result.ok) {
      toast.error("Could not save your checklist", { description: "Your changes are still on screen. Try again in a moment." });
      return;
    }
    onChange(result.data.appointment);
  }

  function addQuestion() {
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    void persist({ ...prep, questions: [...prep.questions, q].slice(0, 30) });
  }

  return (
    <div id={id} className="grid gap-6 md:grid-cols-2" aria-busy={saving}>
      <fieldset className="m-0 grid content-start gap-3 border-0 p-0">
        <legend className="mb-1 p-0 text-small font-semibold text-ink">Bring or do (practical items, not medical advice)</legend>
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-3">
            <Checkbox
              id={`${id}-${item.id}`}
              checked={!!prep.checked[item.id]}
              onCheckedChange={(v) => void persist({ ...prep, checked: { ...prep.checked, [item.id]: v === true } })}
            />
            <Label htmlFor={`${id}-${item.id}`} className="grid gap-0.5 font-normal">
              <span className="text-body text-ink">{item.label}</span>
              {item.id === "records" ? (
                <Link href={`/cases/${appointment.caseId}/documents`} className="w-fit text-small text-teal underline decoration-teal/35 underline-offset-4 focus-ring">
                  Open your document library
                </Link>
              ) : item.hint ? (
                <span className="text-small text-ink-2">{item.hint}</span>
              ) : null}
            </Label>
          </div>
        ))}
      </fieldset>
      <div className="grid content-start gap-3">
        <Label htmlFor={`${id}-q`} className="text-small font-semibold text-ink">My questions</Label>
        <p className="m-0 text-small text-ink-2">In your words, for you to ask. Added to the calendar event.</p>
        {prep.questions.length ? (
          <ol className="m-0 grid gap-2 p-0 pl-5">
            {prep.questions.map((q, i) => (
              <li key={`${i}-${q}`} className="text-body text-ink">
                <span className="flex items-start justify-between gap-2">
                  <span className="break-words">{q}</span>
                  <IconButton label={`Remove question ${i + 1}`} size="sm" onClick={() => void persist({ ...prep, questions: prep.questions.filter((_, j) => j !== i) })}>
                    <X aria-hidden />
                  </IconButton>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex gap-2">
          <Input
            id={`${id}-q`}
            value={draft}
            maxLength={500}
            placeholder="Type a question"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addQuestion();
              }
            }}
          />
          <Button variant="secondary" onClick={addQuestion} disabled={!draft.trim()}>
            <Plus aria-hidden /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}
