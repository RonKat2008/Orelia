"use client";

import { useEffect, useState } from "react";
import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE, hasDisclosure } from "@/lib/safety/disclosure";
import { fieldValue, type ShareableFieldKey } from "./fields";
import { highlightSharedValues } from "./highlight";
import {
  approveContactDraft,
  contactLabel,
  createContactDraft,
  loadCase,
  readStoredOutreach,
  type ApiContact,
  type ApiDraft,
} from "./client";
import type { CaseInput } from "@/lib/contracts";

type Row = {
  contact: ApiContact;
  draft: ApiDraft | null;
  approvedAt: string | null;
  error: string[] | null;
};

export function OutboxList({ caseId }: { caseId: string }) {
  const [caseRecord, setCaseRecord] = useState<CaseInput | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState<string | null>("Loading drafts from the server.");

  useEffect(() => {
    let active = true;
    void (async () => {
      const [record, stored] = await Promise.all([loadCase(caseId), Promise.resolve(readStoredOutreach(caseId))]);
      if (!active) return;
      setCaseRecord(record);
      if (!stored || stored.contacts.length === 0) {
        setNotice("Save contacts on the consent page first. There is nothing to approve.");
        setRows([]);
        return;
      }
      const next: Row[] = [];
      for (const contact of stored.contacts) {
        const created = await createContactDraft(contact.id);
        if (!active) return;
        next.push({
          contact,
          draft: created.ok ? created.draft : null,
          approvedAt: created.ok && typeof created.draft.approvedAt === "string" ? created.draft.approvedAt : null,
          error: created.ok ? null : created.reasons,
        });
      }
      setRows(next);
      setNotice(null);
    })();
    return () => {
      active = false;
    };
  }, [caseId]);

  async function approve(row: Row) {
    if (!row.draft) return;
    setNotice(null);
    const result = await approveContactDraft(row.contact.id, row.draft.id);
    setRows((current) =>
      current.map((entry) => {
        if (entry.contact.id !== row.contact.id) return entry;
        if (!result.ok) return { ...entry, approvedAt: null, error: result.reasons };
        return { ...entry, approvedAt: result.approvedAt, error: null };
      }),
    );
    setNotice(result.ok ? `Approved at ${result.approvedAt}. The server confirmed this.` : "Approval was refused.");
  }

  return (
    <div>
      {notice ? <p role="status">{notice}</p> : null}
      <ul className="plain">
        {rows.map((row) => {
          const draft = row.draft;
          const text = draft?.body ?? "";
          const keys = (draft?.sharedFields ?? []) as ShareableFieldKey[];
          const values = caseRecord ? keys.map((key) => fieldValue(caseRecord, key)) : [];
          const runs = highlightSharedValues(text, values);
          const disclosure = draft?.channel === "voice" ? AI_DISCLOSURE_VOICE : AI_DISCLOSURE_EMAIL;
          const disclosed = text.length > 0 && hasDisclosure(text);
          return (
            <li key={row.contact.id}>
              <article data-channel={draft?.channel ?? row.contact.channel} data-approved={row.approvedAt ? "true" : "false"}>
                <h2>{contactLabel(row.contact)}</h2>
                <p className="note">
                  {row.contact.channel === "email" ? `Email to ${row.contact.address}` : `Call script for ${row.contact.address}`}
                </p>
                {draft?.channel === "email" && draft.subject ? <p>Subject: {draft.subject}</p> : null}
                {draft ? (
                  <p>
                    {runs.map((run, index) =>
                      run.shared ? <mark key={index}>{run.text}</mark> : <span key={index}>{run.text}</span>,
                    )}
                  </p>
                ) : (
                  <ul>
                    {(row.error ?? ["No draft."]).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
                <p>
                  <strong>AI assistance disclosure: </strong>
                  {disclosed ? disclosure : "Missing — approval stays disabled until this sentence is in the draft."}
                </p>
                {row.approvedAt ? <p role="status">Approved {row.approvedAt}</p> : null}
                {row.error && draft ? (
                  <div role="alert">
                    <p>The outbound gate refused this draft. Nothing was marked approved.</p>
                    <ul>
                      {row.error.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="actions">
                  <button type="button" onClick={() => void approve(row)} disabled={!draft || !disclosed || Boolean(row.approvedAt)}>
                    Approve
                  </button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
