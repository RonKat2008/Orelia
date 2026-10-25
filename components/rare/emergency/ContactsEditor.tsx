"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { cardInputsSchema, emergencyContactSchema, MAX_CONTACTS, type EmergencyContact } from "@/lib/rare-disease/emergency/contract";

const BLANK: EmergencyContact = { name: "", relationship: "", phone: "" };

/** First readable problem with one contact, or null. */
export function contactProblem(c: EmergencyContact): string | null {
  const parsed = emergencyContactSchema.safeParse(c);
  if (parsed.success) return null;
  const empty = !c.name.trim() || !c.relationship.trim() || !c.phone.trim();
  return empty ? "Fill in the name, who they are to you, and a phone number." : "Use plain letters, and numbers for the phone.";
}

/** Rows that are fully blank are dropped; the rest must all be valid. */
export function cleanContacts(rows: readonly EmergencyContact[]): { ok: true; contacts: EmergencyContact[] } | { ok: false; error: string } {
  const filled = rows.filter((r) => r.name.trim() || r.relationship.trim() || r.phone.trim());
  const problem = filled.map(contactProblem).find((p) => p !== null);
  if (problem) return { ok: false, error: problem };
  const contacts = filled.map((r) => ({ name: r.name.trim(), relationship: r.relationship.trim(), phone: r.phone.trim() }));
  const checked = cardInputsSchema.shape.contacts.safeParse(contacts);
  return checked.success ? { ok: true, contacts: checked.data } : { ok: false, error: "Check your contacts and try again." };
}

export interface ContactsEditorProps {
  initial: readonly EmergencyContact[];
  onSave: (contacts: EmergencyContact[]) => void;
}

export function ContactsEditor({ initial, onSave }: ContactsEditorProps) {
  const [rows, setRows] = useState<EmergencyContact[]>(initial.length > 0 ? [...initial] : [BLANK]);
  const [error, setError] = useState<string | null>(null);

  const edit = (i: number, patch: Partial<EmergencyContact>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = () => {
    const result = cleanContacts(rows);
    if (!result.ok) return setError(result.error);
    setError(null);
    onSave(result.contacts);
  };

  return (
    <div className="grid gap-3">
      {rows.map((row, i) => (
        <fieldset key={i} className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-3">
          <legend className="sr-only">{`Contact ${i + 1}`}</legend>
          <Field label="Name" htmlFor={`ec-name-${i}`}>
            <Input id={`ec-name-${i}`} autoComplete="off" value={row.name} onChange={(e) => edit(i, { name: e.target.value })} />
          </Field>
          <Field label="Who they are to you" htmlFor={`ec-rel-${i}`}>
            <Input id={`ec-rel-${i}`} autoComplete="off" value={row.relationship} onChange={(e) => edit(i, { relationship: e.target.value })} />
          </Field>
          <Field label="Phone" htmlFor={`ec-phone-${i}`}>
            <Input id={`ec-phone-${i}`} type="tel" inputMode="tel" autoComplete="off" value={row.phone} onChange={(e) => edit(i, { phone: e.target.value })} />
          </Field>
        </fieldset>
      ))}
      {error ? <p role="alert" className="m-0 text-small font-semibold text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {rows.length < MAX_CONTACTS ? (
          <Button variant="secondary" onClick={() => setRows((r) => [...r, BLANK])}>Add another contact</Button>
        ) : null}
        {rows.length > 1 ? (
          <Button variant="ghost" onClick={() => setRows((r) => r.slice(0, -1))}>Remove last</Button>
        ) : null}
        <Button variant="secondary" onClick={save}>Update card</Button>
      </div>
    </div>
  );
}
