"use client";

import Link from "next/link";
import { GOAL_LABELS } from "./model";
import { useJourney } from "./JourneyShell";

export function CaseHome({ caseId }: { caseId: string }) {
  const { plan, data } = useJourney();
  const summary = data?.summary ?? null;
  const openTasks = data?.openTaskCount;

  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">Case {caseId}</p>
      </header>
      <h1>{summary?.diseaseName ?? "This case"}</h1>
      <p className="lede">
        A summary of the fields you confirmed, where research stands, and the next action. Wayfinder
        coordinates contact. It does not interpret the case or suggest care.
      </p>

      {!data ? null : data.missingCase ? (
        <p className="error" role="alert">
          This case was not found. <a href="/">Start from intake</a>.
        </p>
      ) : null}
      {data && !data.missingCase && !summary ? (
        <p className="notice">Case details could not be loaded. You can still move through the steps above.</p>
      ) : null}

      <section className="panel stack" aria-labelledby="case-fields">
        <h2 id="case-fields">Confirmed fields</h2>
        {summary ? (
          <dl className="summary-list">
            <div>
              <dt>Condition name</dt>
              <dd>{summary.diseaseName}</dd>
            </div>
            {summary.subtype ? (
              <div>
                <dt>Subtype</dt>
                <dd>{summary.subtype}</dd>
              </div>
            ) : null}
            {summary.stageSummary ? (
              <div>
                <dt>Stage summary you entered</dt>
                <dd>{summary.stageSummary}</dd>
              </div>
            ) : null}
            {summary.location ? (
              <div>
                <dt>Home</dt>
                <dd>{summary.location}</dd>
              </div>
            ) : null}
            {summary.insurer ? (
              <div>
                <dt>Insurer</dt>
                <dd>{summary.insurer}</dd>
              </div>
            ) : null}
            <div>
              <dt>Goals you chose</dt>
              <dd>{summary.goals.length > 0 ? summary.goals.map((goal) => GOAL_LABELS[goal] ?? goal).join(", ") : "None recorded"}</dd>
            </div>
            <div>
              <dt>Research status</dt>
              <dd>
                <span className="status">{summary.status || "Unknown"}</span>
              </dd>
            </div>
            <div>
              <dt>Selected contacts</dt>
              <dd>{data?.selectedCount === null || data?.selectedCount === undefined ? "Unavailable" : data.selectedCount}</dd>
            </div>
            <div>
              <dt>Open tasks needing your approval</dt>
              <dd>{openTasks === null || openTasks === undefined ? "Unavailable" : openTasks}</dd>
            </div>
          </dl>
        ) : (
          <p>No confirmed fields yet.</p>
        )}
        <div className="row">
          <a className="button" href={plan.nextHref}>
            {plan.nextLabel}
          </a>
          <Link className="secondary button" href="/how-it-works">
            How it works
          </Link>
          <Link className="secondary button" href="/trust">
            Trust
          </Link>
        </div>
      </section>
    </main>
  );
}
