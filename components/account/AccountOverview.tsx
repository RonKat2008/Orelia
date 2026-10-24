"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { Account, LibraryDocument } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { List, ListRow } from "@/components/ui/list-row";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { AccountGate } from "./AccountGate";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { SECTION_TITLE } from "./FormBits";
import { apiRequest } from "./helpers/api";

function useDocumentCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void apiRequest<{ documents: LibraryDocument[] }>("/api/account/documents").then((res) => {
      if (live && res.ok) setCount(res.data?.documents.length ?? 0);
    });
    return () => {
      live = false;
    };
  }, []);
  return count;
}

function OverviewBody({ account }: { account: Account }) {
  const count = useDocumentCount();
  const firstName = account.name?.trim().split(/\s+/)[0];
  return (
    <div className="grid max-w-wide gap-12">
      <section aria-labelledby="hello" className="grid gap-4">
        <h2 id="hello" className={SECTION_TITLE}>
          {firstName ? `Hello, ${firstName}.` : "Hello."}
        </h2>
        <List label="Your account">
          <ListRow
            href="/account/profile"
            title="Profile"
            meta="Who you are and where you live, so you never retype it."
          />
          <ListRow
            href="/account/documents"
            title="Documents"
            meta="Your private medical document library."
            trailing={count !== null ? `${count} ${count === 1 ? "document" : "documents"}` : undefined}
          />
        </List>
      </section>

      <section aria-labelledby="appearance-heading" className="grid gap-4">
        <h2 id="appearance-heading" className={SECTION_TITLE}>Appearance</h2>
        <div className="flex flex-wrap items-center gap-4">
          <ThemeToggle />
          <p className="m-0 text-small text-ink-2">Light, dark, or match your device.</p>
        </div>
      </section>

      <section aria-labelledby="data-heading" className="grid gap-4">
        <h2 id="data-heading" className={SECTION_TITLE}>Manage your data</h2>
        <div className="grid gap-1">
          <p className="m-0 max-w-prose text-body text-ink-2">
            You own your information. Get a copy of your profile, cases and document details.
          </p>
          <Button asChild variant="link" className="min-h-11 w-fit text-body">
            <a href="/api/account/export" download><Download aria-hidden />Download my data (JSON)</a>
          </Button>
        </div>
        <div className="grid gap-1 border-t border-line pt-4">
          <p className="m-0 max-w-prose text-body text-ink-2">
            Deleting your account removes your cases, documents, files, profile and sign-in. It cannot be undone.
          </p>
          <div>
            <DeleteAccountDialog />
          </div>
        </div>
      </section>
    </div>
  );
}

export function AccountOverview() {
  return <AccountGate path="/account">{(account) => <OverviewBody account={account} />}</AccountGate>;
}
