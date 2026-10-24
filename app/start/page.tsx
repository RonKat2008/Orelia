import type { Metadata } from "next";
import { AppShell } from "@/components/shell";
import { IntakeFlow } from "@/components/intake/IntakeFlow";
import { loadDemoReports } from "@/components/intake/demos";

export const metadata: Metadata = {
  title: "Start with a report | Wayfinder",
  description:
    "Share a pathology or clinic summary. Wayfinder pulls out the details it needs, you confirm every one, then the search begins.",
};

export default function StartPage() {
  const demos = loadDemoReports();
  return (
    <AppShell
      eyebrow="Start here"
      title={
        <>
          Tell us about <em className="emph">your</em> case
        </>
      }
      lede="Share a report. We read it, you check every detail, and only then does the search begin. Nothing leaves this screen without your say-so."
    >
      <IntakeFlow demos={demos} />
    </AppShell>
  );
}
