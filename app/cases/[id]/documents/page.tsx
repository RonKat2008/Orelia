import Link from "next/link";
import { DocumentsPanel } from "@/components/case-docs/DocumentsPanel";

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">Documents</p>
      </header>
      <h1>What outreach can draw on</h1>
      <p className="lede">
        Grouped by kind. The intake report is never sent. Other items say which field you have consented to share, or
        that they are public resource information. Nothing here is a treatment recommendation.
      </p>
      <DocumentsPanel caseId={id} />
    </main>
  );
}
