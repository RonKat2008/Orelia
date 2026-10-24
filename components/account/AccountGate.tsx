"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import type { Account } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { Skeleton } from "@/components/ui/feedback";
import { signInHref } from "./helpers/safe-next";
import { useAccount } from "./helpers/use-account";

/** Renders children only for a signed-in person; otherwise a friendly prompt. Client-side check, no middleware. */
export function AccountGate({ path, children }: { path: string; children: (account: Account) => ReactNode }) {
  const state = useAccount();

  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-4">
        <span className="sr-only">Loading your account</span>
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (!state.enabled) {
    return (
      <EmptyState
        icon={<LockKeyhole />}
        title="Accounts are not available yet"
        description="You can keep using Wayfinder without one. Your cases stay in this browser."
        action={<Button asChild variant="secondary"><Link href="/start">Start a case</Link></Button>}
      />
    );
  }
  if (!state.account) {
    return (
      <EmptyState
        icon={<LockKeyhole />}
        title="Sign in to see this page"
        description="An account keeps your profile and medical documents private and in one place."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild><Link href={signInHref(path)}>Sign in</Link></Button>
            <Button asChild variant="secondary"><Link href="/auth/sign-up">Create an account</Link></Button>
          </div>
        }
      />
    );
  }
  return <>{children(state.account)}</>;
}
