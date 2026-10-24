import Link from "next/link";
import { demoEnabled } from "@/app/api/demo/lib/guard";
import { cn } from "@/lib/ui/cn";
import { Wordmark } from "./Wordmark";

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Wayfinder",
    links: [
      { href: "/start", label: "Start a case" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/about", label: "About" },
      { href: "/demo", label: "See a demo" },
      { href: "/start?view=judge", label: "For judges: watch the agents work" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { href: "/trust", label: "Trust & safety" },
      { href: "/trust#sources", label: "How we cite sources" },
      { href: "/trust#consent", label: "Your approval, always" },
    ],
  },
];

/** Footer columns; "See a demo" only when the demo control panel is enabled (the page 404s otherwise). */
export function footerColumns(env: Record<string, string | undefined>) {
  const showDemo = demoEnabled(env);
  return COLUMNS.map((column) => ({ ...column, links: column.links.filter((link) => showDemo || link.href !== "/demo") }));
}

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer data-slot="site-footer" className={cn("grain mt-section border-t border-line bg-paper-2", className)}>
      <div className="page-container grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="grid max-w-sm content-start gap-4">
          <Wordmark />
          <p className="m-0 text-body text-ink-2">
            Helping adults with a rare disease get seen: specialists, trials, advocates and aid, every claim with its
            source, nothing sent without your approval.
          </p>
        </div>
        {footerColumns(process.env).map((column) => (
          <nav key={column.heading} aria-label={column.heading} className="grid content-start gap-3">
            <h2 className="m-0 max-w-none font-sans text-small font-semibold text-ink-2">{column.heading}</h2>
            <ul className="m-0 grid list-none gap-2 p-0">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="rounded-sm text-body text-ink no-underline decoration-teal/40 underline-offset-4 hover:text-teal hover:underline focus-ring"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="page-container m-0 py-6 text-small text-ink-2">
          Wayfinder never gives medical advice. In an emergency call 911 or contact your care team.
        </p>
      </div>
    </footer>
  );
}
