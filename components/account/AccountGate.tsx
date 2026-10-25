"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import type { Account } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { Skeleton } from "@/components/ui/feedback";
import { LoadingState } from "@/components/ui/states";
import { safeNext, signInHref } from "./helpers/safe-next";
import { useAccount } from "./helpers/use-account";

/** Renders children only for a signed-in person; otherwise a friendly prompt. Client-side check, no middleware. */
export function AccountGate({ path, children }: { path: string; children: (account: Account) => ReactNode }) {
  const state = useAccount();

  if (state.status === "loading") {
    return (
      <LoadingState label="Loading your account">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </LoadingState>
    );
  }
  if (!state.enabled) {
    return (
      <EmptyState
        icon={<LockKeyhole />}
        title="Accounts are not available yet"
        description="You can keep using Orelia without one. Your cases stay in this browser."
        className="max-w-xl gap-1 px-5 py-5"
        action={<Button asChild size="lg"><Link href="/start">Start a case</Link></Button>}
      />
    );
  }
  if (!state.account) {
    return (
      <EmptyState
        icon={<LockKeyhole />}
        title="Sign in to see your account"
        description="An account keeps your profile and medical documents private and in one place."
        className="max-w-xl gap-1 px-5 py-5"
        action={
          <div className="-mt-2 flex flex-wrap items-center gap-x-6 gap-y-1">
            <Button asChild size="lg"><Link href={signInHref(path)}>Sign in</Link></Button>
            <Button asChild variant="link" className="min-h-11 text-body"><Link href={`/auth/sign-up?next=${encodeURIComponent(safeNext(path))}`}>Create an account</Link></Button>
          </div>
        }
      />
    );
  }
  return <>{children(state.account)}</>;
}
