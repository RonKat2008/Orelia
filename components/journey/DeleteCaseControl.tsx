"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/ui/cn";
import { deleteCase } from "./delete-case";

/**
 * "Delete case" with an in-app confirm step (ConfirmDialog, never window.confirm). A quiet danger-ghost trigger that
 * belongs in a "Manage case" area, never beside the next step (docs/DESIGN-v2.md 4.1).
 */
export function DeleteCaseControl({ caseId, className }: { caseId: string; className?: string }) {
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
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="danger-ghost" size="sm" className={cn("w-fit", className)} data-testid="delete-case">
          <Trash2 aria-hidden />
          Delete case
        </Button>
      }
      title="Delete this case?"
      description="This removes your case and everything in it for good, but messages already sent stay with the people who got them."
      confirmLabel="Delete case"
      cancelLabel="Keep it"
      busy={busy}
      busyLabel="Deleting"
      error={error}
      onConfirm={() => void confirm()}
      confirmTestId="delete-case-confirm"
    />
  );
}
