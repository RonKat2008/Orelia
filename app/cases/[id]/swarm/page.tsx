import Link from "next/link";
import { SwarmView } from "@/components/swarm/SwarmView";

export default async function SwarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">Research in progress</p>
      </header>
      <h1>The team looking for resources</h1>
      <p className="lede">
        Nine researchers work at once. Each card shows whether that search is waiting, running, or
        finished, and how many records it kept.
      </p>
      <SwarmView caseId={id} />
    </main>
  );
}
