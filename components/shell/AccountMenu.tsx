"use client";

import { useEffect } from "react";
import Link from "next/link";
import { FileText, LogOut, User, UserRound } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { SheetClose } from "@/components/ui/sheet";
import { AvatarInitials } from "@/components/ui/display";
import { apiRequest } from "@/components/account/helpers/api";
import { claimIfPending, useAccount } from "@/components/account/helpers/use-account";
import { cn } from "@/lib/ui/cn";

const ITEM =
  "flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-small font-semibold text-ink no-underline outline-none " +
  "transition-colors duration-150 data-[highlighted]:bg-teal-soft data-[highlighted]:text-teal-ink dark:data-[highlighted]:text-teal [&_svg]:size-4 [&_svg]:text-ink-2";

async function signOut() {
  await apiRequest("/api/account/sign-out", { method: "POST" });
  // Full navigation on purpose: the server cleared cookies, so every cached client state must go.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

/**
 * Header account control. Renders nothing until GET /api/account says accounts are enabled:
 * a "Sign in" link when signed out, an avatar menu (Account, Profile, Documents, Sign out) when signed in.
 */
export function AccountMenu({ className }: { className?: string }) {
  const state = useAccount();
  const signedIn = state.status === "ready" && state.account !== null;

  useEffect(() => {
    if (signedIn) void claimIfPending();
  }, [signedIn]);

  if (state.status !== "ready" || !state.enabled) return null;

  if (!state.account) {
    return (
      <Link
        href="/auth/sign-in"
        className={cn(
          "hidden rounded-sm px-3 py-2 text-small font-semibold text-ink-2 no-underline transition-colors duration-150 hover:text-ink focus-ring sm:inline-flex",
          className,
        )}
      >
        Sign in
      </Link>
    );
  }

  const label = state.account.name?.trim() || state.account.email;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Account menu for ${label}`}
        className={cn(
          "group inline-flex h-10 cursor-pointer items-center gap-2 rounded-pill border border-line bg-card py-1 pl-1 pr-3 text-small font-semibold text-ink",
          "transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-sm focus-ring data-[state=open]:border-teal",
          className,
        )}
      >
        <AvatarInitials name={label} size="sm" />
        <span className="hidden max-w-32 truncate sm:inline">{state.account.name?.trim().split(/\s+/)[0] ?? "Account"}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(
            "z-50 min-w-56 rounded-md border border-line bg-card p-1.5 text-ink shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] motion-reduce:animate-none",
          )}
        >
          <div className="px-3 pb-2 pt-1.5">
            <p className="m-0 truncate text-small font-semibold text-ink">{state.account.name ?? "Your account"}</p>
            <p className="m-0 truncate text-micro text-ink-3">{state.account.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild className={ITEM}>
            <Link href="/account"><UserRound aria-hidden />Account</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={ITEM}>
            <Link href="/account/profile"><User aria-hidden />Profile</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={ITEM}>
            <Link href="/account/documents"><FileText aria-hidden />Documents</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={ITEM} onSelect={() => void signOut()}>
            <LogOut aria-hidden />Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const SHEET_LINK =
  "flex min-h-12 items-center border-b border-line font-display text-h3 text-ink no-underline focus-ring";

/** Account links for the phone menu drawer. Renders nothing when accounts are not enabled. */
export function MobileAccountLinks() {
  const state = useAccount();
  if (state.status !== "ready" || !state.enabled) return null;
  if (!state.account) {
    return (
      <nav aria-label="Account" className="mt-2 grid">
        <SheetClose>
          <Link href="/auth/sign-in" className={SHEET_LINK}>Sign in</Link>
        </SheetClose>
      </nav>
    );
  }
  return (
    <nav aria-label="Account" className="mt-2 grid">
      <SheetClose><Link href="/account" className={SHEET_LINK}>Account</Link></SheetClose>
      <SheetClose><Link href="/account/profile" className={SHEET_LINK}>Profile</Link></SheetClose>
      <SheetClose><Link href="/account/documents" className={SHEET_LINK}>Documents</Link></SheetClose>
      <button type="button" onClick={() => void signOut()} className={cn(SHEET_LINK, "cursor-pointer bg-transparent text-left")}>
        Sign out
      </button>
    </nav>
  );
}
