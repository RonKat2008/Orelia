"use client";

import type * as React from "react";
import { useEffect } from "react";
import Link from "next/link";
import { Check, CircleUserRound, FileText, LogIn, LogOut, Monitor, Moon, Sun, SunMoon, User, UserPlus, UserRound } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { SheetClose } from "@/components/ui/sheet";
import { AvatarInitials } from "@/components/ui/display";
import { apiRequest } from "@/components/account/helpers/api";
import { claimIfPending, useAccount } from "@/components/account/helpers/use-account";
import { cn } from "@/lib/ui/cn";
import { setThemePreference, useThemePreference, type ThemePreference } from "./theme";

const ITEM =
  "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-small font-semibold text-ink no-underline outline-none " +
  "transition-colors duration-150 data-[highlighted]:bg-teal-soft data-[highlighted]:text-teal-ink dark:data-[highlighted]:text-teal [&_svg]:size-4 [&_svg]:text-ink-2";

const TRIGGER =
  "inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-pill border border-line bg-card text-ink-2 " +
  "transition-[border-color,color] duration-150 hover:border-line-strong hover:text-ink focus-ring data-[state=open]:border-teal";

const THEMES: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "Match device", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

async function signOut() {
  await apiRequest("/api/account/sign-out", { method: "POST" });
  // Full navigation on purpose: the server cleared cookies, so every cached client state must go.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

/** Appearance: one labelled radio group inside the menu (the old three-way header toggle, docs/DESIGN-v2.md 6). */
function AppearanceItems() {
  const preference = useThemePreference();
  return (
    <>
      <DropdownMenu.Label className="px-3 pb-1 pt-2 text-small text-ink-2">Appearance</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={preference} onValueChange={(value) => setThemePreference(value as ThemePreference)}>
        {THEMES.map(({ value, label, Icon }) => (
          <DropdownMenu.RadioItem key={value} value={value} className={cn(ITEM, "data-[state=checked]:text-teal-ink dark:data-[state=checked]:text-teal")}>
            <Icon aria-hidden />
            <span className="flex-1">{label}</span>
            <DropdownMenu.ItemIndicator className="[&_svg]:text-teal">
              <Check aria-hidden />
            </DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </>
  );
}

function MenuContent({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={8}
        className={cn(
          "z-50 min-w-60 rounded-md border border-line bg-card p-1.5 text-ink shadow-md",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] motion-reduce:animate-none",
        )}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

/**
 * Header account control: always one round button that opens a menu holding the account links (when accounts are
 * on) and Appearance (light / match device / dark). Signed in it shows the avatar. Renders a same-size placeholder
 * while the account state loads, so the header never shifts.
 */
export function AccountMenu({ className }: { className?: string }) {
  const state = useAccount();
  const signedIn = state.status === "ready" && state.account !== null;

  useEffect(() => {
    if (signedIn) void claimIfPending();
  }, [signedIn]);

  if (state.status !== "ready") return <span aria-hidden className={cn("inline-block size-10 shrink-0", className)} />;

  const account = state.enabled ? state.account : null;
  const label = account ? account.name?.trim() || account.email : null;
  const triggerLabel = label ? `Account menu for ${label}` : state.enabled ? "Account and appearance" : "Appearance";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label={triggerLabel} className={cn(TRIGGER, account && "border-transparent bg-transparent p-0", className)}>
        {account && label ? (
          <AvatarInitials name={label} size="sm" />
        ) : state.enabled ? (
          <CircleUserRound aria-hidden className="size-5" />
        ) : (
          <SunMoon aria-hidden className="size-5" />
        )}
      </DropdownMenu.Trigger>
      <MenuContent>
        {account ? (
          <>
            <div className="px-3 pb-2 pt-1.5">
              <p className="m-0 truncate text-small font-semibold text-ink">{account.name ?? "Your account"}</p>
              <p className="m-0 truncate text-small text-ink-2">{account.email}</p>
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
          </>
        ) : state.enabled ? (
          <>
            <DropdownMenu.Item asChild className={ITEM}>
              <Link href="/auth/sign-in"><LogIn aria-hidden />Sign in</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild className={ITEM}>
              <Link href="/auth/sign-up"><UserPlus aria-hidden />Create an account</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
          </>
        ) : null}
        <AppearanceItems />
        {account ? (
          <>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className={ITEM} onSelect={() => void signOut()}>
              <LogOut aria-hidden />Sign out
            </DropdownMenu.Item>
          </>
        ) : null}
      </MenuContent>
    </DropdownMenu.Root>
  );
}

/** "Sign in" text link for marketing headers when accounts are on and nobody is signed in. */
export function SignInLink({ className }: { className?: string }) {
  const state = useAccount();
  if (state.status !== "ready" || !state.enabled || state.account) return null;
  return (
    <Link
      href="/auth/sign-in"
      className={cn(
        "hidden whitespace-nowrap rounded-sm px-3 py-2 text-small font-semibold text-ink-2 no-underline transition-colors duration-150 hover:text-ink focus-ring sm:inline-flex",
        className,
      )}
    >
      Sign in
    </Link>
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
