import type { ReactNode } from "react";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { accountsEnabled } from "@/lib/auth/neon";
import { AuthCard } from "./AuthCard";

/** Server-only availability check; client forms never read server auth configuration. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader cta={null} />
      <main id="main" className="page-container grid justify-items-center pb-8 pt-6 sm:pt-8">
        {accountsEnabled() ? children : (
          <AuthCard title="Accounts are unavailable" lede="Sign-in and account creation are not available right now. You can still start a case without an account.">
            <Button asChild size="lg"><Link href="/start">Start a case</Link></Button>
          </AuthCard>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
