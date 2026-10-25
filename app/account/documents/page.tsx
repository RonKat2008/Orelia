import type { Metadata } from "next";
import { DocumentLibrary } from "@/components/account/documents/DocumentLibrary";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = { title: "Your documents", description: "Your private medical document library.", robots: { index: false } };

export default function DocumentsPage() {
  return (
    <AppShell
      eyebrow="Account"
      title="Your documents"
      lede="Keep lab results, scans and letters in one private library that Orelia can read for you."
    >
      <DocumentLibrary />
    </AppShell>
  );
}
