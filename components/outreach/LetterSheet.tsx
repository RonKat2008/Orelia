import type { ReactNode } from "react";
import { Mail, PhoneCall, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { splitDisclosure } from "./letter";
import { highlightSharedValues } from "./highlight";

/**
 * The letter in a well (docs/DESIGN-v2.md 4.4): quoted message text for the consent preview, outbox drafts and the
 * patient message card. No border, no shadow and no accent line, so it can sit inside a pane without nesting boxes.
 */
export function LetterSheet({
  channel,
  recipient,
  subject,
  label,
  children,
  className,
}: {
  channel: "email" | "voice";
  recipient: string;
  subject?: string | null;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const Icon = channel === "email" ? Mail : PhoneCall;
  return (
    <figure aria-label={label} data-slot="letter" className={cn("m-0 min-w-0 rounded-md bg-paper-2", className)}>
      <figcaption className="grid gap-1 border-b border-line px-5 py-4 sm:px-6">
        <span className="flex items-center gap-2 text-small font-semibold text-ink-2">
          <Icon aria-hidden className={cn("size-4 shrink-0", channel === "email" ? "text-ch-email" : "text-ch-call")} />
          {label}
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere] text-small text-ink-2">
          {channel === "email" ? "To: " : "Calling: "}
          <span className="font-semibold text-ink">{recipient}</span>
        </span>
        {subject ? <span className="break-words text-body font-semibold text-ink">{subject}</span> : null}
      </figcaption>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-5 py-5 text-body leading-relaxed text-ink sm:px-6">{children}</div>
    </figure>
  );
}

/** The sentence that says an AI helped, set apart so it is never missed. */
export function DisclosureLine({ children }: { children: ReactNode }) {
  return (
    <p data-slot="ai-disclosure" className="m-0 flex gap-3 border-l-2 border-ok py-1 pl-3 text-body text-ink">
      <ShieldCheck aria-hidden className="mt-1 size-4 shrink-0 text-ok" />
      <span className="min-w-0 break-words">
        <span className="block text-small font-semibold text-ink-2">AI disclosure</span>
        {children}
      </span>
    </p>
  );
}

/** Message text with the disclosure lifted out and shared case values marked. */
export function MessageBody({ text, sharedValues }: { text: string; sharedValues: readonly string[] }) {
  const segments = splitDisclosure(text);
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "disclosure") return <DisclosureLine key={index}>{segment.text}</DisclosureLine>;
        return (
          <p key={index} className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {highlightSharedValues(segment.text.trim(), sharedValues).map((run, runIndex) =>
              run.shared ? (
                <mark key={runIndex} className="rounded-sm bg-gold-soft px-1 text-ink underline decoration-gold decoration-2 underline-offset-4">
                  {run.text}
                </mark>
              ) : (
                <span key={runIndex}>{run.text}</span>
              ),
            )}
          </p>
        );
      })}
    </>
  );
}
