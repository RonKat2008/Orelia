"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Callout } from "./FormBits";
import { apiRequest } from "./helpers/api";
import { signInHref } from "./helpers/safe-next";
import { useAccount } from "./helpers/use-account";

interface ImportResult {
  imported: number;
  skipped: number;
}

/** Case-page card: copy the signed-in account's embedded library documents into this case's history. */
export function UseMyDocuments({ caseId }: { caseId: string }) {
  const state = useAccount();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== "ready" || !state.enabled) return null;

  if (!state.account) {
    return (
      <p aria-label="Your documents" className="m-0 text-small text-ink-2">
        <Link
          href={signInHref(pathname)}
          className="font-semibold text-teal underline decoration-teal/35 underline-offset-[0.22em] hover:text-teal-ink focus-ring rounded-sm"
        >
          Sign in to use documents from your library
        </Link>
      </p>
    );
  }

  async function onImport() {
    setPending(true);
    setError(null);
    const res = await apiRequest<ImportResult>(`/api/cases/${encodeURIComponent(caseId)}/history/import-library`, { method: "POST" });
    setPending(false);
    if (res.ok && res.data) {
      const n = res.data.imported;
      toast.success(`Added ${n} ${n === 1 ? "document" : "documents"} to this case's history`);
      // Client views that load the case history listen for this (e.g. the history workspace).
      window.dispatchEvent(new CustomEvent("wayfinder:history-changed", { detail: { caseId } }));
      router.refresh();
      return;
    }
    setError(
      res.status === 403
        ? "This case belongs to a different account."
        : (res.message ?? "We could not add your documents. Please try again."),
    );
  }

  return (
    <div className="grid gap-2">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <p className="m-0 flex flex-wrap items-center gap-x-5 gap-y-1 text-small text-ink-2">
        <Button variant="link" className="min-h-11 text-small" loading={pending} loadingText="Adding" onClick={() => void onImport()}>
          <FolderInput aria-hidden />Use my documents
        </Button>
        <Link
          href="/account/documents"
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-[0.22em] hover:text-teal-ink focus-ring"
        >
          Manage documents
        </Link>
        <span>Adds them to this case&rsquo;s history. Nothing is shared.</span>
      </p>
    </div>
  );
}
