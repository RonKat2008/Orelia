"use client";

import { useState } from "react";
import type { LibraryDocument } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Callout } from "../FormBits";
import { apiRequest } from "../helpers/api";
import { docsUrl, type SpaceScope } from "../helpers/space";
import { draftForDocument, metadataFromDraft, type MetadataDraft } from "../helpers/metadata";
import { MetadataFields } from "./MetadataFields";

export function EditDocumentDialog({
  doc,
  onClose,
  onSaved,
  scope,
}: {
  doc: LibraryDocument | null;
  onClose: () => void;
  onSaved: (doc: LibraryDocument) => void;
  scope?: SpaceScope;
}) {
  return (
    <Dialog open={doc !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl">
        {doc ? <EditForm key={doc.id} doc={doc} onClose={onClose} onSaved={onSaved} scope={scope} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ doc, onClose, onSaved, scope }: { doc: LibraryDocument; onClose: () => void; onSaved: (doc: LibraryDocument) => void; scope?: SpaceScope }) {
  const [draft, setDraft] = useState<MetadataDraft>(() => draftForDocument(doc));
  const [errors, setErrors] = useState<Partial<Record<keyof MetadataDraft, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const meta = metadataFromDraft(draft);
    if (!meta.ok) {
      setErrors(meta.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    const res = await apiRequest<{ document: LibraryDocument }>(docsUrl(scope, `/${doc.id}`), { method: "PATCH", json: meta.value });
    setPending(false);
    if (res.ok && res.data) {
      onSaved(res.data.document);
      onClose();
      return;
    }
    setFormError(res.message ?? "We could not save your changes. Please try again.");
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit details</DialogTitle>
        <DialogDescription>Changing details does not change the file itself.</DialogDescription>
      </DialogHeader>
      <MetadataFields
        idPrefix={`edit-${doc.id}`}
        draft={draft}
        errors={errors}
        disabled={pending}
        onChange={(change) => { setDraft((prev) => ({ ...prev, ...change })); setErrors({}); }}
      />
      {formError ? <Callout tone="danger" role="alert">{formError}</Callout> : null}
      <DialogFooter>
        <DialogClose asChild><Button variant="secondary" disabled={pending}>Cancel</Button></DialogClose>
        <Button loading={pending} loadingText="Saving" onClick={() => void save()}>Save changes</Button>
      </DialogFooter>
    </>
  );
}

export function DeleteDocumentDialog({
  doc,
  onClose,
  onConfirm,
}: {
  doc: LibraryDocument | null;
  onClose: () => void;
  onConfirm: (doc: LibraryDocument) => void;
}) {
  return (
    <Dialog open={doc !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this document?</DialogTitle>
          <DialogDescription>
            {doc ? <>&ldquo;{doc.title}&rdquo; and the text Orelia read from it will be removed from this space. This cannot be undone.</> : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="secondary">Keep it</Button></DialogClose>
          <Button variant="danger" onClick={() => { if (doc) onConfirm(doc); onClose(); }}>Delete document</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
