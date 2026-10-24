"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Callout, TextField } from "./FormBits";
import { apiRequest } from "./helpers/api";

const CONFIRM_WORD = "DELETE";

export function DeleteAccountDialog() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setPending(true);
    setError(null);
    const res = await apiRequest("/api/account", { method: "DELETE", json: { confirm: CONFIRM_WORD } });
    if (res.ok) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears all client state
      window.location.assign("/");
      return;
    }
    setError(res.message ?? "We could not delete your account. Please try again.");
    setPending(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          setTyped("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger">Delete account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently deletes your cases, documents, stored files, profile and sign-in. We cannot recover them.
          </DialogDescription>
        </DialogHeader>
        <TextField
          id="delete-confirm"
          label={`Type ${CONFIRM_WORD} to confirm`}
          value={typed}
          onValueChange={setTyped}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>Keep my account</Button>
          </DialogClose>
          <Button variant="danger" disabled={typed !== CONFIRM_WORD} loading={pending} loadingText="Deleting" onClick={() => void onDelete()}>
            Delete everything
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
