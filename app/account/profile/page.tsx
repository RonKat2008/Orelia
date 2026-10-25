import type { Metadata } from "next";
import { ProfileForm } from "@/components/account/ProfileForm";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = { title: "Your profile", description: "Details Orelia can reuse when you start a case.", robots: { index: false } };

export default function ProfilePage() {
  return (
    <AppShell
      eyebrow="Account"
      title="Your profile"
      lede="Fill in what you like, skip what you do not. Only the fields you tick when you contact someone are ever shared."
    >
      <ProfileForm />
    </AppShell>
  );
}
