import { Check, Lock, X } from "lucide-react";
import { cn } from "@/lib/ui/cn";

const WE_USE = [
  "Diagnosis and subtype, to find people who see it",
  "Home city and state, to measure distance",
  "Insurer and plan, to check who is in network",
  "Travel limit and goals, to rank what you asked for",
];

const WE_NEVER = [
  "Your name, birth date, record numbers or contact details",
  "Anything sent to a clinic, trial or group before you approve it",
  "Any advice about treatment, outlook or what to choose",
];

function Group({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "use" | "never";
}) {
  const Icon = tone === "use" ? Check : X;
  return (
    <section aria-label={title} className="grid gap-3">
      <h3 className="m-0 flex items-center gap-2 text-h4 font-bold text-ink">
        <span
          aria-hidden
          className={cn(
            "grid size-6 place-items-center rounded-pill",
            tone === "use" ? "bg-ok-soft text-ok" : "bg-terracotta-soft text-ink",
          )}
        >
          <Icon className="size-3.5" strokeWidth={3} />
        </span>
        {title}
      </h3>
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-small text-ink-2">
            <span
              aria-hidden
              className={cn("mt-2 size-1.5 shrink-0 rounded-pill", tone === "use" ? "bg-ok" : "bg-terracotta")}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the search uses from the confirmed case, and what stays private. Shown beside the review form. */
export function PrivacyNotes({ className }: { className?: string }) {
  return (
    <aside
      aria-label="How your details are used"
      className={cn(
        "grain grid gap-6 rounded-lg border border-line bg-paper-2 p-5 shadow-inset sm:p-6",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 place-items-center rounded-pill bg-card text-teal shadow-sm ring-1 ring-line">
          <Lock className="size-5" />
        </span>
        <p className="m-0 font-display text-h3 font-normal text-ink display-soft">Minimum necessary</p>
      </div>
      <Group title="What we use" items={WE_USE} tone="use" />
      <Group title="What we never share" items={WE_NEVER} tone="never" />
    </aside>
  );
}
