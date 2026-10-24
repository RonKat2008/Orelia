"use client";

import { useMemo, useState } from "react";
import {
  SHAREABLE_FIELDS,
  defaultSharedFields,
  sharedPreview,
  withheldLabels,
  type ShareableFieldKey,
} from "./fields";
import { writeConsent, type StoredConsent } from "./preview";
import type { CaseInput } from "@/lib/contracts";
import type { OutreachContact } from "./types";

export function ConsentForm({
  caseId,
  caseRecord,
  contacts,
}: {
  caseId: string;
  caseRecord: CaseInput;
  contacts: OutreachContact[];
}) {
  const [sharedByContact, setSharedByContact] = useState<Record<string, ShareableFieldKey[]>>(() =>
    Object.fromEntries(contacts.map((contact) => [contact.id, defaultSharedFields()])),
  );
  const [saved, setSaved] = useState(false);

  const summary = useMemo(
    () =>
      contacts.map((contact) => ({
        contact,
        preview: sharedPreview(caseRecord, sharedByContact[contact.id] ?? []),
        withheld: withheldLabels(sharedByContact[contact.id] ?? []),
      })),
    [caseRecord, contacts, sharedByContact],
  );

  function toggle(contactId: string, key: ShareableFieldKey) {
    setSaved(false);
    setSharedByContact((current) => {
      const selected = current[contactId] ?? [];
      const next = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
      return { ...current, [contactId]: next };
    });
  }

  function save() {
    const payload: StoredConsent = sharedByContact;
    writeConsent(caseId, payload);
    setSaved(true);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {summary.map(({ contact, preview, withheld }) => (
        <article key={contact.id} data-contact-state={contact.state}>
          <h2>{contact.name}</h2>
          <p className="note">
            {contact.role} · {contact.channel === "email" ? contact.address : contact.address}
          </p>
          <fieldset>
            <legend>Fields this contact may receive</legend>
            {SHAREABLE_FIELDS.map((field) => {
              const id = `${contact.id}-${field.key}`;
              const checked = (sharedByContact[contact.id] ?? []).includes(field.key);
              return (
                <label key={field.key} htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(contact.id, field.key)}
                  />
                  <span>{field.label}</span>
                </label>
              );
            })}
          </fieldset>
          <h3>What will be shared</h3>
          {preview.length === 0 ? (
            <p>Nothing. This draft would include no case details.</p>
          ) : (
            <dl>
              {preview.map((item) => (
                <span key={item.key} style={{ display: "contents" }}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </span>
              ))}
            </dl>
          )}
          <p className="note">
            {withheld.length === 0
              ? "Every listed field is included."
              : `Stays private: ${withheld.join(", ")}.`}
          </p>
        </article>
      ))}
      <div className="actions">
        <button type="submit">Save consent</button>
        <a href={`/cases/${caseId}/outbox`}>Review drafts</a>
      </div>
      {saved ? <p role="status">Consent saved for this case in this browser session.</p> : null}
    </form>
  );
}
