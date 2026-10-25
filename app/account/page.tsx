import type { Metadata } from "next";
import { AccountOverview } from "@/components/account/AccountOverview";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = { title: "Your account", description: "Your Orelia profile, documents and data.", robots: { index: false } };

export default function AccountPage() {
  return (
    <AppShell eyebrow="Account" title="Your account" lede="Your profile, your documents and your data, private to you.">
      <AccountOverview />
    </AppShell>
  );
}
