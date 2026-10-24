"use client";

import { useState, useSyncExternalStore } from "react";
import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE, hasDisclosure } from "@/lib/safety/disclosure";
import { requestApproval } from "./approve";
import { fieldValue, type ShareableFieldKey } from "./fields";
import { highlightSharedValues } from "./highlight";
import { readConsentRaw, subscribeConsent, type StoredConsent } from "./preview";
import type { CaseInput } from "@/lib/contracts";
import type { OutreachDraft } from "./types";

function draftText(draft: OutreachDraft["draft"]): string {
  return draft.channel === "email" ? draft.body : draft.script;
}

function withEditedText(draft: OutreachDraft, text: string): OutreachDraft["draft"] {
  if (draft.draft.channel === "email") return { ...draft.draft, body: text };
  return { ...draft.draft, script: text };
}

export function OutboxList({
  caseId,
  caseRecord,
  drafts,
}: {
  caseId: string;
  caseRecord: CaseInput;
  drafts: OutreachDraft[];
}) {
  const [items, setItems] = useState(drafts);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const consentRaw = useSyncExternalStore(
    subscribeConsent,
    () => readConsentRaw(caseId),
    () => null,
  );
  let stored: StoredConsent | null = null;
  if (consentRaw) {
    try {
      stored = JSON.parse(consentRaw) as StoredConsent;
    } catch {
      stored = null;
    }
  }

  function sharedKeys(item: OutreachDraft): ShareableFieldKey[] {
    const fromConsent = stored?.[item.contactId];
    if (fromConsent && fromConsent.length > 0) return fromConsent as ShareableFieldKey[];
    return item.sharedFields;
  }

  async function approve(item: OutreachDraft) {
    const result = await requestApproval({ contactId: item.contactId, draftId: item.id });
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, approvedAt: result.approvedAt, rejected: false } : entry,
      ),
    );
    setNotice(
      result.source === "api"
        ? `Approved at ${result.approvedAt}.`
        : `Approved at ${result.approvedAt}. The approve API is not available yet, so this timestamp is stored in the page only.`,
    );
  }

  function reject(id: string) {
    setItems((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, rejected: true, approvedAt: null } : entry)),
    );
    setNotice("Draft rejected. Nothing will be sent.");
  }

  return (
    <div>
      <ul className="plain">
        {items.map((item) => {
          const keys = sharedKeys(item);
          const text = draftText(item.draft);
          const values = keys.map((key) => fieldValue(caseRecord, key));
          const runs = highlightSharedValues(text, values);
          const disclosure = item.draft.channel === "email" ? AI_DISCLOSURE_EMAIL : AI_DISCLOSURE_VOICE;
          const disclosed = hasDisclosure(text);
          return (
            <li key={item.id}>
              <article data-channel={item.draft.channel} data-approved={item.approvedAt ? "true" : "false"}>
                <h2>{item.contactName}</h2>
                <p className="note">
                  {item.draft.channel === "email" ? `Email to ${item.draft.to}` : `Call script for ${item.draft.toNumber}`}
                </p>
                {item.draft.channel === "email" ? <p>Subject: {item.draft.subject}</p> : null}
                {editing === item.id ? (
                  <label>
                    Edit draft
                    <textarea
                      value={text}
                      onChange={(event) => {
                        const next = event.target.value;
                        setItems((current) =>
                          current.map((entry) =>
                            entry.id === item.id ? { ...entry, draft: withEditedText(entry, next) } : entry,
                          ),
                        );
                      }}
                    />
                  </label>
                ) : (
                  <p>
                    {runs.map((run, index) =>
                      run.shared ? <mark key={index}>{run.text}</mark> : <span key={index}>{run.text}</span>,
                    )}
                  </p>
                )}
                <p>
                  <strong>AI assistance disclosure: </strong>
                  {disclosed ? disclosure : "Missing — approval should wait until this sentence is in the draft."}
                </p>
                <p className="note">Highlighted text is a case field this contact is allowed to see.</p>
                {item.approvedAt ? <p role="status">Approved {item.approvedAt}</p> : null}
                {item.rejected ? <p role="status">Rejected</p> : null}
                <div className="actions">
                  <button type="button" onClick={() => approve(item)} disabled={!disclosed || item.rejected}>
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditing(editing === item.id ? null : item.id)}
                  >
                    {editing === item.id ? "Done editing" : "Edit"}
                  </button>
                  <button type="button" className="secondary" onClick={() => reject(item.id)}>
                    Reject
                  </button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}
