import type { ReactNode } from "react";
import { Mail, PhoneCall, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { splitDisclosure } from "./letter";
import { highlightSharedValues } from "./highlight";

/** The sheet of paper: used for the consent preview and for outbox drafts. */
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
    <figure
      aria-label={label}
      className={cn(
        "relative m-0 overflow-hidden rounded-md border border-line bg-card shadow-md",
        "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-terracotta before:content-['']",
        className,
      )}
    >
      <figcaption className="grid gap-1 border-b border-line bg-paper-2/60 px-5 py-4 sm:px-7">
        <span className="flex items-center gap-2 text-micro font-semibold uppercase text-ink-3">
          <Icon aria-hidden className={cn("size-4", channel === "email" ? "text-ch-email" : "text-ch-call")} />
          {label}
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere] text-small text-ink-2">
          {channel === "email" ? "To: " : "Calling: "}
          <span className="font-semibold text-ink">{recipient}</span>
        </span>
        {subject ? (
          <span className="break-words font-display text-h4 font-normal text-ink display-soft">{subject}</span>
        ) : null}
      </figcaption>
      <div className="grid gap-4 px-5 py-6 text-body leading-relaxed text-ink sm:px-7">{children}</div>
    </figure>
  );
}

/** The sentence that says an AI helped, set apart so it is never missed. */
export function DisclosureLine({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex gap-3 rounded-md border border-sage bg-sage-soft px-4 py-3 text-body text-ink">
      <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
      <span className="min-w-0 break-words">
        <span className="mb-0.5 block text-micro font-semibold uppercase text-ink-2">AI disclosure</span>
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
          <p key={index} className="m-0 whitespace-pre-wrap break-words">
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
