import { Headphones } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import type { LiveCall } from "@/lib/activity/types";
import { clockTime } from "./format";

const STATUS_TEXT: Record<LiveCall["status"], string> = { queued: "Queued", ringing: "Ringing", connected: "Connected", ended: "Ended" };

/** Safe listen links only: provider WebSocket/HTTPS URLs, shown as a link and never rendered as HTML. */
const isListenable = (url: string | undefined): url is string => !!url && /^(https|wss):\/\//i.test(url);

/** Small live-call panel for one lane: status, streaming turns (AI vs callee), summary once ended. All text is plain. */
export function LiveCallPanel({ call }: { call: LiveCall }) {
  const live = call.live;
  const body = (
    <div className="grid gap-1.5">
      {call.turns.length === 0 ? (
        <p className="m-0 text-small text-ink-2">{live ? "Waiting for the first words…" : "No transcript recorded."}</p>
      ) : (
        <ol className="m-0 grid max-h-56 list-none gap-1 overflow-y-auto p-0" aria-label="Call transcript">
          {call.turns.map((t) => (
            <li
              key={t.seq}
              className={cn(
                "max-w-[92%] break-words rounded-md px-2 py-1 text-small",
                t.role === "ai" ? "justify-self-start bg-ch-call-soft text-ink" : "justify-self-end border border-line bg-card text-ink",
              )}
            >
              <span className="mr-1.5 font-semibold text-ink-2">{t.role === "ai" ? "AI" : "Callee"}</span>
              {t.at ? <span className="mr-1.5 tabular-nums text-ink-2">{clockTime(t.at)}</span> : null}
              <span className="whitespace-pre-wrap">{t.text}</span>
            </li>
          ))}
        </ol>
      )}
      {call.summary ? (
        <p className="m-0 border-l-2 border-teal pl-2 text-small text-ink">
          <span className="font-semibold">Summary: </span>
          <span className="whitespace-pre-wrap break-words">{call.summary}</span>
        </p>
      ) : null}
    </div>
  );

  return (
    <section aria-label="Live call" className="grid gap-1.5 rounded-md border border-line bg-paper-2 p-2" data-live={live}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
        <span className="font-semibold text-ink">{call.provider === "vapi-web" ? (live ? "Live browser call" : "Browser call") : live ? "Live call" : "Call"}</span>
        <span className={cn("inline-flex items-center gap-1 text-ink-2", live && "font-semibold text-ch-call")}>
          {live ? <span aria-hidden className="live-pulse size-2 rounded-pill bg-current" /> : null}
          {STATUS_TEXT[call.status]}
          {call.outcome && !live ? ` · ${call.outcome}` : ""}
        </span>
        {isListenable(call.listenUrl) ? (
          <a href={call.listenUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-sm text-teal-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal dark:text-teal">
            <Headphones aria-hidden className="size-3.5" />Listen in
          </a>
        ) : null}
      </div>
      {live ? body : (
        <details>
          <summary className="cursor-pointer rounded-sm text-small text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">
            Transcript ({call.turns.length} line{call.turns.length === 1 ? "" : "s"})
          </summary>
          <div className="mt-1.5">{body}</div>
        </details>
      )}
    </section>
  );
}
