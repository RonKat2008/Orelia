import Link from "next/link";
import { IntakeFlow } from "@/components/intake/IntakeFlow";
import { loadDemoReports } from "@/components/intake/demos";

export default function HomePage() {
  const demos = loadDemoReports();
  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">Find the right door</p>
      </header>
      <h1>Tell us about the case</h1>
      <p className="lede">
        Wayfinder reads a report, then looks for specialists, centers, trials, advocacy groups, and
        aid. You confirm every field before research starts.
      </p>
      <IntakeFlow demos={demos} />
    </main>
  );
}
