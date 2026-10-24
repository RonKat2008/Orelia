"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SHAREABLE_FIELDS,
  defaultSharedFields,
  sharedPreview,
  withheldLabels,
  type ShareableFieldKey,
} from "./fields";
import {
  contactLabel,
  loadCase,
  readSelectedCandidateIds,
  readStoredOutreach,
  saveContactConsent,
  selectOutreach,
  writeStoredOutreach,
  type ApiContact,
  type UnavailableContact,
} from "./client";
import type { CaseInput } from "@/lib/contracts";

export function ConsentForm({ caseId }: { caseId: string }) {
  const [caseRecord, setCaseRecord] = useState<CaseInput | null>(null);
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableContact[]>([]);
  const [sharedByContact, setSharedByContact] = useState<Record<string, ShareableFieldKey[]>>({});
  const [status, setStatus] = useState<string | null>("Loading the case and selected resources.");
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const record = await loadCase(caseId);
      if (!active) return;
      setCaseRecord(record);
      const ids = readSelectedCandidateIds(caseId);
      if (ids.length === 0) {
        const stored = readStoredOutreach(caseId);
        if (stored) {
          setContacts(stored.contacts);
          setUnavailable(stored.unavailable);
          setSharedByContact(Object.fromEntries(stored.contacts.map((contact) => [contact.id, defaultSharedFields()])));
        }
        setStatus(
          ids.length === 0 && !stored
            ? "Select up to five resources on the shortlist first. Nothing is contacted until you save consent and approve a draft."
            : null,
        );
        return;
      }
      const selected = await selectOutreach(caseId, ids);
      if (!active) return;
      if (!selected.ok) {
        setErrors(selected.reasons);
        setStatus("Those resources could not be opened as contacts.");
        return;
      }
      writeStoredOutreach(caseId, selected.value);
      setContacts(selected.value.contacts);
      setUnavailable(selected.value.unavailable);
      setSharedByContact(
        Object.fromEntries(selected.value.contacts.map((contact) => [contact.id, defaultSharedFields()])),
      );
      setStatus(null);
    })();
    return () => {
      active = false;
    };
  }, [caseId]);

  const summary = useMemo(
    () =>
      contacts.map((contact) => ({
        contact,
        preview: caseRecord ? sharedPreview(caseRecord, sharedByContact[contact.id] ?? []) : [],
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

  async function save() {
    setErrors([]);
    setSaved(false);
    const failures: string[] = [];
    for (const contact of contacts) {
      const result = await saveContactConsent(contact.id, sharedByContact[contact.id] ?? []);
      if (!result.ok) failures.push(`${contactLabel(contact)}: ${result.reasons.join(" ")}`);
    }
    if (failures.length > 0) {
      setErrors(failures);
      setStatus("Consent was not saved for every contact.");
      return;
    }
    setSaved(true);
    setStatus("Consent saved. The server recorded which fields each contact may see.");
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {status ? <p role="status">{status}</p> : null}
      {errors.length > 0 ? (
        <ul>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      {unavailable.map((item) => (
        <article key={item.candidateId} data-channel="none">
          <h2>Unavailable</h2>
          <p>
            This resource has no evidenced intake email or phone, so its channel is none. There is no send option.{" "}
            {item.reason}
          </p>
        </article>
      ))}
      {summary.map(({ contact, preview, withheld }) => (
        <article key={contact.id} data-contact-state={contact.state}>
          <h2>{contactLabel(contact)}</h2>
          <p className="note">
            {contact.channel === "email" ? "Email" : "Phone"} · {contact.address}
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
          {!caseRecord ? (
            <p>Case details are not loaded, so the preview is hidden.</p>
          ) : preview.length === 0 ? (
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
            {withheld.length === 0 ? "Every listed field is included." : `Stays private: ${withheld.join(", ")}.`}
          </p>
        </article>
      ))}
      <div className="actions">
        <button type="submit" disabled={contacts.length === 0}>
          Save consent
        </button>
        <a href={`/cases/${caseId}/outbox`}>Review drafts</a>
      </div>
      {saved ? <p role="status">Saved on the server for each contact.</p> : null}
    </form>
  );
}
