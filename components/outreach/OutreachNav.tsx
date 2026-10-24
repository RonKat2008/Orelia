import type { ReactNode } from "react";
import "./outreach.css";

const links = [
  { slug: "consent", label: "Consent" },
  { slug: "plan", label: "Plan" },
  { slug: "outbox", label: "Outbox" },
  { slug: "tracker", label: "Tracker" },
  { slug: "threads", label: "Threads" },
] as const;

export function OutreachNav({
  caseId,
  current,
  children,
}: {
  caseId: string;
  current: (typeof links)[number]["slug"];
  children: ReactNode;
}) {
  return (
    <main className="outreach">
      <nav aria-label="Outreach">
        <ol>
          {links.map((link) => (
            <li key={link.slug}>
              <a
                href={`/cases/${caseId}/${link.slug}`}
                aria-current={link.slug === current ? "page" : undefined}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {children}
    </main>
  );
}
