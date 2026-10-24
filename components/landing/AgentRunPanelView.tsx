import type { Ref } from "react";
import { cn } from "@/lib/ui/cn";
import { RUN_AGENTS, panelLine, type RunFrame } from "./run-script";

export interface AgentRunPanelViewProps {
  frame: RunFrame;
  rootRef?: Ref<HTMLElement>;
  className?: string;
}

/**
 * The hero's sample-case card for one frame of the scripted run: an "Example" label, one status line and one thin
 * progress bar (docs/DESIGN-v2.md 7.1). No hooks, so the server renders it as the static first frame (no JS);
 * AgentRunPanel animates it. It is one picture to a screen reader, so the changing line is not announced.
 */
export function AgentRunPanelView({ frame, rootRef, className }: AgentRunPanelViewProps) {
  const progress = frame.doneCount / RUN_AGENTS.length;
  const line = panelLine(frame);

  return (
    <figure
      ref={rootRef}
      role="img"
      aria-label="Example of a search in progress"
      className={cn(
        "m-0 grid w-full max-w-[22rem] gap-3 rounded-lg border border-line/80 bg-card/90 p-6 shadow-lg backdrop-blur-md",
        className,
      )}
    >
      <p className="m-0 text-small text-ink-3">Example</p>
      <p
        key={line}
        className="m-0 min-h-[1.55em] text-body font-semibold text-ink animate-in fade-in duration-300 ease-out-expo motion-reduce:animate-none"
      >
        {line}
      </p>
      <div aria-hidden className="h-1 overflow-hidden rounded-pill bg-paper-2">
        <div
          className="h-full origin-left rounded-pill bg-teal transition-transform duration-700 ease-out-expo motion-reduce:transition-none"
          style={{ transform: `scaleX(${Math.max(progress, 0.04)})` }}
        />
      </div>
    </figure>
  );
}
