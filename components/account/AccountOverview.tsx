"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Download, FileText, UserRound } from "lucide-react";
import type { Account, LibraryDocument } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

const TILE =
  "group grid gap-4 p-6 no-underline [&_svg]:size-5";

function OverviewBody({ account }: { account: Account }) {
  const count = useDocumentCount();
  const firstName = account.name?.trim().split(/\s+/)[0];
  return (
    <div className="grid gap-12">
      <section aria-labelledby="hello" className="grid gap-6">
        <h2 id="hello" className={SECTION_TITLE}>
          {firstName ? `Hello, ${firstName}.` : "Hello."}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card asChild interactive padding="none" variant="raised">
            <Link href="/account/profile" className={TILE}>
              <span className="flex items-center justify-between text-teal">
                <span className="grid size-10 place-items-center rounded-pill bg-teal-soft"><UserRound aria-hidden /></span>
                <ArrowUpRight aria-hidden className="text-ink-3 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none" />
              </span>
              <span className="grid gap-1">
                <span className="font-display text-h4 text-ink">Profile</span>
                <span className="text-small text-ink-2">Who you are, where you live and what you are managing, so you never retype it.</span>
              </span>
            </Link>
          </Card>
          <Card asChild interactive padding="none" variant="raised">
            <Link href="/account/documents" className={TILE}>
              <span className="flex items-center justify-between text-teal">
                <span className="grid size-10 place-items-center rounded-pill bg-teal-soft"><FileText aria-hidden /></span>
                <ArrowUpRight aria-hidden className="text-ink-3 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none" />
              </span>
              <span className="grid gap-1">
                <span className="font-display text-h4 text-ink">
                  Documents{count !== null ? <span className="ml-2 text-small font-semibold text-ink-2">{count}</span> : null}
                </span>
                <span className="text-small text-ink-2">Your private medical document library. Upload, search and organise.</span>
              </span>
            </Link>
          </Card>
        </div>
      </section>

      <section aria-labelledby="data-heading" className="grid gap-5">
        <h2 id="data-heading" className={SECTION_TITLE}>Your data</h2>
        <Card className="grid gap-5">
          <div className="grid gap-1">
            <h3 className="m-0 text-h4 font-bold text-ink">Download everything</h3>
            <p className="m-0 max-w-prose text-small text-ink-2">
              Get a JSON copy of your profile, cases and document details. You own your information.
            </p>
          </div>
          <div>
            <Button asChild variant="secondary">
              <a href="/api/account/export" download><Download aria-hidden />Download my data (JSON)</a>
            </Button>
          </div>
        </Card>
        <div className="grid gap-4 rounded-lg border border-danger/30 bg-danger-soft/50 p-5 sm:p-6">
          <div className="grid gap-1">
            <h3 className="m-0 text-h4 font-bold text-ink">Delete account</h3>
            <p className="m-0 max-w-prose text-small text-ink-2">
              Permanently removes your cases, documents, stored files, profile and sign-in. This cannot be undone.
            </p>
          </div>
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
