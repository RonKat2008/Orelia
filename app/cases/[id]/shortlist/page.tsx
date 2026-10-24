import Link from "next/link";
import { ShortlistView } from "@/components/shortlist/ShortlistView";

export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">Shortlist</p>
      </header>
      <h1>Resources worth a closer look</h1>
      <p className="lede">
        Grouped by the kind of help they offer. Each reason cites a source. Selecting a resource
        does not contact anyone yet.
      </p>
      <ShortlistView caseId={id} />
    </main>
  );
}
