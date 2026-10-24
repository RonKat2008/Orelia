"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { BookOpenText, Check, ChevronDown, ClipboardCheck, FileText, Keyboard, MessagesSquare, Network, Route, ScrollText } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/ui/cn";
import type { JourneyPlan, JourneyStage } from "@/components/journey/model";

/** Pages that belong to a stage without being its main page (threads live with the tracker). */
const STAGE_ALIASES: Record<string, JourneyStage> = { threads: "tracker" };

const SEGMENT_STAGE: Record<string, JourneyStage> = {
  swarm: "research",
  shortlist: "shortlist",
  consent: "consent",
  plan: "plan",
  outbox: "outreach",
  tracker: "tracker",
};

/** The stage whose page is open, from the path (null on tool pages such as documents). */
export function stageForPath(pathname: string, caseId: string): JourneyStage | "appointments" | null {
  const base = `/cases/${caseId}`;
  if (pathname === base) return "intake";
  const segment = pathname.slice(base.length + 1).split("/")[0] ?? "";
  if (segment === "appointments") return "appointments";
  return SEGMENT_STAGE[segment] ?? STAGE_ALIASES[segment] ?? null;
}

const MENU_ITEM =
  "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-small font-semibold text-ink no-underline outline-none " +
  "transition-colors duration-150 data-[highlighted]:bg-teal-soft data-[highlighted]:text-teal-ink dark:data-[highlighted]:text-teal [&_svg]:size-4 [&_svg]:text-ink-2";

function ToolsMenu({ plan, caseId, pathname }: { plan: JourneyPlan; caseId: string; pathname: string }) {
  const tools = [
    { href: plan.expertsHref, label: "From research to care", Icon: Route },
    { href: `/cases/${caseId}/coordinate`, label: "Coordinate care", Icon: Network },
    { href: `/cases/${caseId}/threads`, label: "Threads", Icon: MessagesSquare },
    { href: plan.documentsHref, label: "Documents", Icon: FileText },
    { href: plan.historyHref, label: "Medical history", Icon: ScrollText },
    { href: plan.researchHref, label: "Condition research", Icon: BookOpenText },
    { href: `/cases/${caseId}/review`, label: "Review", Icon: ClipboardCheck },
  ];
  const onTool = tools.some((tool) => pathname === tool.href || pathname.startsWith(`${tool.href}/`));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-small font-semibold text-ink-2",
          "transition-colors duration-150 hover:text-ink focus-ring-inset data-[state=open]:text-ink",
          onTool && "text-teal-ink dark:text-teal",
        )}
      >
        Tools
        <ChevronDown aria-hidden className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-60 rounded-md border border-line bg-card p-1.5 text-ink shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          {tools.map(({ href, label, Icon }) => (
            <DropdownMenu.Item key={href} asChild className={MENU_ITEM}>
              <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                <Icon aria-hidden />
                {label}
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <p className="m-0 flex items-center gap-2 px-3 py-2 text-small text-ink-2">
            <Keyboard aria-hidden className="size-4" />
            Lists: j / k to move, Enter to open
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface StageBarProps {
  plan: JourneyPlan;
  caseId: string;
  pathname: string;
  /** Case name for the context line ("Ehlers-Danlos syndrome (suspected)"). */
  caseName?: string | null;
}

/**
 * StageBar: the judge view's one navigation system (docs/DESIGN-v2.md 5.3). The 7 stages in one quiet row, with a
 * check on completed stages, a teal underline on the page you are on, a small dot on the stage the case is at, and
 * a Tools menu for everything else. Scrolls sideways inside itself on phones; never repeats "Step N of 7".
 */
export function StageBar({ plan, caseId, pathname, caseName }: StageBarProps) {
  const open = stageForPath(pathname, caseId);
  const listRef = useRef<HTMLOListElement>(null);
  // On phones the row scrolls sideways: bring the open page's stage into view.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    const offset = current.offsetLeft - list.offsetLeft;
    if (offset + current.offsetWidth > list.clientWidth || offset < list.scrollLeft) {
      list.scrollLeft = Math.max(0, offset - 16);
    }
  }, [pathname]);
  const stages = plan.steps.map((step) => ({
    ...step,
    // "Case" is the case home here, not /start.
    href: step.id === "intake" ? `/cases/${caseId}` : step.href,
  }));

  return (
    <div data-slot="stage-bar" className="border-b border-line">
      {caseName ? (
        <p className="m-0 truncate pt-4 text-small text-ink-2 sm:hidden">
          <span className="font-semibold text-ink">{caseName}</span>
        </p>
      ) : null}
      <nav aria-label="Case stages" className="flex items-center gap-2">
        <ol
          ref={listRef}
          className="m-0 flex min-w-0 flex-1 list-none items-center gap-1 overflow-x-auto p-0 [scrollbar-width:none] max-lg:[mask-image:linear-gradient(to_right,black_85%,transparent)]"
        >
          {stages.map((step) => {
            const viewing = open === step.id;
            const done = step.state === "complete";
            const atStage = step.state === "current";
            return (
              <li key={step.id} className="shrink-0">
                <Link
                  href={step.href}
                  aria-current={viewing ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-small font-semibold no-underline focus-ring-inset",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-pill after:bg-teal after:transition-transform after:duration-200",
                    viewing ? "text-ink after:scale-x-100" : "text-ink-2 after:scale-x-0 hover:text-ink",
                  )}
                >
                  {done ? <Check aria-hidden className="size-4 text-ok" /> : null}
                  {atStage && !done ? <span aria-hidden className="size-2 rounded-pill bg-teal" /> : null}
                  {step.label}
                  <span className="sr-only">{done ? " (done)" : atStage ? " (current stage)" : ""}</span>
                </Link>
              </li>
            );
          })}
          <li className="shrink-0">
            <Link
              href={`/cases/${caseId}/appointments`}
              aria-current={open === "appointments" ? "page" : undefined}
              className={cn(
                "relative inline-flex h-11 items-center whitespace-nowrap rounded-sm px-2.5 text-small font-semibold no-underline focus-ring-inset",
                "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-pill after:bg-teal",
                open === "appointments" ? "text-ink after:scale-x-100" : "text-ink-2 after:scale-x-0 hover:text-ink",
              )}
            >
              Appointments
            </Link>
          </li>
        </ol>
        <ToolsMenu plan={plan} caseId={caseId} pathname={pathname} />
      </nav>
      {plan.notes.length > 0 ? (
        <ul className="m-0 grid list-none gap-1 p-0 pb-3 text-small text-warn-ink">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
