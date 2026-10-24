"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  addPatientNote,
  groupDocuments,
  kindLabel,
  loadDocuments,
  sharingLine,
  type CaseDocument,
} from "./data";

export function DocumentsPanel({ caseId }: { caseId: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sharedField, setSharedField] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDocuments(caseId).then((result) => {
      if (!active) return;
      if (result.status === "error") {
        setStatus("error");
        setMessage(result.message);
        return;
      }
      if (result.status === "empty") {
        setStatus("empty");
        setPreview(result.preview);
        setDocuments([]);
        return;
      }
      setStatus("ready");
      setPreview(result.preview);
      setDocuments(result.documents);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedText = text.trim();
    if (!trimmedTitle || !trimmedText) {
      setMessage("Add a title and the note text before saving.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await addPatientNote(caseId, {
      title: trimmedTitle,
      text: trimmedText,
      sharedField: sharedField.trim() || undefined,
    });
    setSaving(false);
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    setDocuments((current) => [...current, result.document]);
    setStatus("ready");
    setPreview(result.preview);
    setTitle("");
    setText("");
    setSharedField("");
    setMessage(result.preview ? "Saved on this page until the documents service is connected." : "Saved.");
  }

  const groups = groupDocuments(documents);

  return (
    <div className="stack">
      {status === "loading" ? <p className="notice">Loading documents…</p> : null}
      {status === "error" ? <p className="error">{message}</p> : null}
      {preview && status !== "error" && status !== "loading" ? (
        <p className="notice">
          Preview of what outreach agents can draw on. The live document list replaces it when that service answers.
        </p>
      ) : null}
      {status === "empty" ? (
        <p>No documents yet. A note you add here is available to outreach only for the field you name.</p>
      ) : null}
      {groups.map((group) => (
        <section key={group.kind} className="stack" aria-labelledby={`docs-${group.kind}`}>
          <h2 id={`docs-${group.kind}`}>{kindLabel(group.kind)}</h2>
          <ul className="stack">
            {group.items.map((document) => (
              <li key={document.id} className="panel">
                <h3>{document.title}</h3>
                <p>{sharingLine(document)}</p>
                <p className="meta">{new Date(document.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <form className="panel stack" onSubmit={onSubmit}>
        <h2>Add a note</h2>
        <p className="meta">
          Outreach can use this note only for the field you name. Leave the field blank and it stays general public
          context, not part of the intake report.
        </p>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} name="title" />
        </label>
        <label className="field">
          <span>Note</span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} name="text" />
        </label>
        <label className="field">
          <span>Field you consent to share</span>
          <input
            value={sharedField}
            onChange={(event) => setSharedField(event.target.value)}
            name="sharedField"
            placeholder="condition name"
          />
        </label>
        <button className="button" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save note"}
        </button>
        {message && status !== "error" ? <p className="notice">{message}</p> : null}
      </form>
    </div>
  );
}
