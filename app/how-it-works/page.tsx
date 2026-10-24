import Link from "next/link";

export const metadata = {
  title: "How Wayfinder works",
  description: "What the research and contact agents do, and what they never send on their own.",
};

export default function HowItWorksPage() {
  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">How it works</p>
      </header>
      <h1>How Wayfinder works</h1>
      <p className="lede">
        Wayfinder looks up specialists, centers, recruiting trials, advocacy groups, and financial or
        travel aid, then helps you reach the ones you pick. It coordinates contact. It does not
        interpret reports or suggest care.
      </p>
      <nav className="page-links" aria-label="Related">
        <Link href="/trust">What Wayfinder will not do</Link>
        <Link href="/">Start a case</Link>
      </nav>
      <section className="panel stack" aria-labelledby="agents-heading">
        <h2 id="agents-heading">What the agents do</h2>
        <ol className="explain-list">
          <li>Intake reads the report you paste and asks you to confirm each field before research starts.</li>
          <li>
            Research agents look in public sources for specialists and centers, recruiting trials, advocacy
            organizations, and aid programs. A verifier drops any claim that has no source.
          </li>
          <li>You review a shortlist and select at most five contacts.</li>
          <li>You tick the case fields that may be included in each message. Unchecked fields stay out.</li>
          <li>
            Drafts wait for your approval. After you approve, a connection agent can email or call that
            contact and turn replies into tasks you approve.
          </li>
          <li>The tracker shows each contact&apos;s state and anything still waiting on you.</li>
        </ol>
      </section>
      <section className="stack" aria-labelledby="limits-heading">
        <h2 id="limits-heading">Limits you can count on</h2>
        <ul className="explain-list">
          <li>Every claim shown about a resource links to its source.</li>
          <li>Nothing is sent unless you approve it, and a message includes only the fields you tick.</li>
          <li>A case can have at most five active contacts.</li>
          <li>Every outbound email, and the start of every call, says that AI assistance was used.</li>
          <li>In this demo, sending is test-only. Messages go only to inboxes and phone numbers we own.</li>
        </ul>
      </section>
    </main>
  );
}
