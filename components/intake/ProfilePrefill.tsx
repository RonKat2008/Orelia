"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserRound } from "lucide-react";
import type { Profile } from "@/lib/accounts/contract";
import { profileReportText } from "@/lib/accounts/prefill";
import { Button } from "@/components/ui";

/** Signed-in patients' profile, for intake pre-fill. null while loading, signed out, or without a profile. */
export function useIntakeProfile(): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const account = await fetch("/api/account", { credentials: "same-origin" }).then(r => (r.ok ? r.json() : null));
        if (!account?.account) return;
        const res = await fetch("/api/account/profile", { credentials: "same-origin" });
        const body = res.ok ? await res.json() : null;
        if (live && body?.profile) setProfile(body.profile as Profile);
      } catch {
        // Pre-fill is a convenience; intake works without it.
      }
    })();
    return () => { live = false; };
  }, []);
  return profile;
}

/** "Start from my profile" card above the report step. Renders nothing without a profile diagnosis. */
export function ProfilePrefillCard({ profile, onUse }: { profile: Profile | null; onUse: (text: string) => void }) {
  const text = profileReportText(profile);
  if (!profile || !text) return null;
  return (
    <section aria-labelledby="profile-prefill-heading" className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-teal-soft/60 p-4 sm:p-5">
      <UserRound aria-hidden className="size-5 shrink-0 text-teal" />
      <div className="min-w-0 flex-1">
        <h2 id="profile-prefill-heading" className="m-0 text-body font-semibold text-ink">Start from your profile, {profile.preferredName}</h2>
        <p className="m-0 text-small text-ink-2">
          We will fill in your diagnosis and location from your profile. You can edit everything before the search, and
          nothing is shared until you tick it. <Link href="/account/profile" className="text-teal">Edit profile</Link>
        </p>
      </div>
      <Button type="button" size="sm" onClick={() => onUse(text)}>Use my profile</Button>
    </section>
  );
}
