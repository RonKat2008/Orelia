import Link from "next/link";
import { DeleteCaseStub } from "@/components/journey/DeleteCaseStub";

export const metadata = {
  title: "Trust",
  description: "What Wayfinder will never do, and how to ask for a case to be deleted.",
};

export default function TrustPage() {
  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">Trust</p>
      </header>
      <h1>What Wayfinder will never do</h1>
      <p className="lede">
        Wayfinder finds public intake doors and drafts contact for you to approve. The limits below
        are part of the product, not optional settings.
      </p>
      <nav className="page-links" aria-label="Related">
        <Link href="/how-it-works">How it works</Link>
        <Link href="/">Start a case</Link>
      </nav>
      <section className="panel" aria-labelledby="never-heading">
        <h2 id="never-heading">Never</h2>
        <ul className="explain-list">
          <li>Give medical advice, interpret a prognosis, or rank care options.</li>
          <li>Contact a person or organization unless you approved that message.</li>
          <li>Scrape personal email addresses. Outreach uses public intake doors only.</li>
        </ul>
      </section>
      <section className="stack" aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete a case</h2>
        <p>You can ask for a case to be removed. This demo does not delete stored cases yet.</p>
        <DeleteCaseStub />
      </section>
      <p className="notice">If you have new or worsening symptoms, contact your care team or call 911.</p>
    </main>
  );
}
