"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
import { toast } from "@/components/ui/toast";
import { deleteCase } from "./delete-case";

/** "Delete case" with an in-app confirm step (the design-system Dialog, never window.confirm). */
export function DeleteCaseControl({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await deleteCase(caseId);
    if (result.ok) {
      setOpen(false);
      toast.success("Case deleted");
      router.push("/");
      router.refresh();
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="mt-6 text-danger" data-testid="delete-case">
          <Trash2 aria-hidden />
          Delete case
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this case?</DialogTitle>
          <DialogDescription>
            This permanently removes the case, its research, documents, contacts, messages and tracker tasks. It cannot be
            undone. Messages already sent to a resource stay with that resource.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              Keep case
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={confirm} disabled={busy} aria-busy={busy} data-testid="delete-case-confirm">
            {busy ? "Deleting" : "Delete case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
