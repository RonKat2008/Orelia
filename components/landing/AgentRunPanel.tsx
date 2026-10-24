"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, Mail, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceChip } from "@/components/ui/source-chip";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { cn } from "@/lib/ui/cn";
import { AI_DISCLOSURE_EMAIL } from "@/lib/safety/disclosure";
import { ChannelCombo } from "./channels";
import { PLAN_EXAMPLES } from "./content";
import { useHeroMotion } from "./HeroMotion";
import {
  FINAL_FRAME,
  RUN_AGENTS,
  RUN_KEYFRAMES,
  RUN_SOURCES,
  delayAfter,
  frameAt,
  nextKeyframe,
  type AgentStatus,
} from "./run-script";

const RESOLVED = PLAN_EXAMPLES.slice(0, 3);

const reveal =
  "transition-[opacity,transform] duration-700 ease-out-expo motion-reduce:transition-none data-[shown=false]:pointer-events-none data-[shown=false]:translate-y-3 data-[shown=false]:opacity-0";

function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [isOnScreen, setIsOnScreen] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let intersecting = true;
    const update = () => setIsOnScreen(intersecting && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? true;
      update();
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref]);
  return isOnScreen;
}

function StatusMark({ status, found, isPaused }: { status: AgentStatus; found: number; isPaused: boolean }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-small font-semibold text-ok">
        <CheckCircle2 aria-hidden className="size-4" strokeWidth={2.25} />
        {found} found
      </span>
    );
  }
  if (status === "searching") {
    return (
      <span className="inline-flex items-center gap-1.5 text-small font-semibold text-teal">
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-pill border-2 border-teal/25 border-t-teal motion-reduce:animate-none"
          style={isPaused ? { animationPlayState: "paused" } : undefined}
        />
        Searching
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-ink-3">
      <CircleDashed aria-hidden className="size-4" />
      Waiting
    </span>
  );
}

/**
 * The hero's "agents at work" panel: a scripted, clearly labelled illustrative run.
 * Agents tick to done, source chips land, the curator picks a best fit, then a
 * draft waits for approval. Reduced motion shows the finished state, still.
 */
export function AgentRunPanel({ className }: { className?: string }) {
  const reduced = useReducedMotionGate();
  const { isPaused } = useHeroMotion();
  const rootRef = useRef<HTMLElement>(null);
  const isOnScreen = useOnScreen(rootRef);
  const [keyframe, setKeyframe] = useState(0);
  const [hasTriedApprove, setHasTriedApprove] = useState(false);

  const isRunning = !reduced && !isPaused && isOnScreen;
  useEffect(() => {
    if (!isRunning) return;
    const id = setTimeout(() => setKeyframe((index) => nextKeyframe(index)), delayAfter(keyframe));
    return () => clearTimeout(id);
  }, [isRunning, keyframe]);

  const frame = reduced ? FINAL_FRAME : frameAt(RUN_KEYFRAMES[keyframe] ?? 0);
  const progress = frame.doneCount / RUN_AGENTS.length;
  const visibleSources = RUN_SOURCES.slice(0, frame.visibleSources).reverse();

  return (
    <figure
      ref={rootRef}
      aria-label="Illustrative example of a Wayfinder case run, not real results"
      className={cn("relative m-0 w-full max-w-[34rem]", className)}
    >
      <div className="relative">
        {/* A second sheet of paper behind the panel, for depth. */}
        <div
          aria-hidden
          className="absolute inset-x-5 -bottom-2.5 top-5 rotate-[2deg] rounded-lg border border-line bg-paper-2 shadow-md"
        />

        <div className="relative overflow-hidden rounded-lg border border-line/80 bg-card/90 shadow-xl backdrop-blur-md">
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
            <div className="grid min-w-0 gap-0.5">
              <p className="m-0 text-micro font-semibold uppercase text-ink-3">Sample case</p>
              <p className="m-0 truncate text-small font-semibold text-ink">Adult · vascular Ehlers-Danlos · Ohio</p>
            </div>
            <Badge tone="gold" className="mt-0.5">
              Illustrative example
            </Badge>
          </header>

          <div className="px-4 pt-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 truncate text-small text-ink-2">
                {frame.caption}
              </p>
              <span className="shrink-0 font-mono text-mono text-ink-3">
                {frame.doneCount}/{RUN_AGENTS.length}
              </span>
            </div>
            <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-pill bg-paper-2 shadow-inset">
              <div
                className="h-full origin-left rounded-pill bg-teal transition-transform duration-700 ease-out-expo motion-reduce:transition-none"
                style={{ transform: `scaleX(${Math.max(progress, 0.02)})` }}
              />
            </div>
          </div>

          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0 px-2 py-2 sm:px-3">
            {RUN_AGENTS.map((agent, i) => {
              const status = frame.agents[i]?.status ?? "waiting";
              return (
                <li
                  key={agent.id}
                  data-status={status}
                  className="flex h-10 items-center gap-3 rounded-md px-2 transition-colors duration-500 data-[status=searching]:bg-teal-soft/60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-pill transition-colors duration-500",
                      status === "done" ? "bg-ok" : status === "searching" ? "bg-teal" : "bg-line-strong",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-small">
                    <span className="font-semibold text-ink">{agent.label}</span>
                    <span className="text-ink-3"> · {agent.task}</span>
                  </span>
                  <StatusMark status={status} found={agent.found} isPaused={isPaused} />
                </li>
              );
            })}
          </ul>

          <div className="flex h-12 items-center gap-3 border-t border-line bg-paper-2/60 pl-4 sm:pl-5">
            <span className="shrink-0 text-micro font-semibold uppercase text-ink-3">Sources</span>
            {/* Newest first; older chips slide right and fade under the edge mask. */}
            <ul className="m-0 flex min-w-0 flex-1 list-none gap-1.5 overflow-hidden p-0 pr-4 [mask-image:linear-gradient(to_right,black_75%,transparent)]">
              {visibleSources.map((source) => (
                <li
                  key={source.domain}
                  className="shrink-0 animate-in fade-in slide-in-from-left-3 duration-700 ease-out-expo motion-reduce:animate-none"
                >
                  {/* Scheme-less on purpose: sample chips are not links. */}
                  <SourceChip url={source.domain} verified />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div
        data-shown={frame.curated}
        className={cn(reveal, "relative z-10 -mt-5 ml-4 rounded-lg border border-line bg-card p-4 shadow-lg sm:ml-10")}
      >
        <div className="flex items-center justify-between gap-2">
          <Badge tone="teal">
            <Sparkles aria-hidden />
            Verified &amp; planned
          </Badge>
          <span className="text-micro font-semibold uppercase text-ink-3">How we&apos;ll reach each</span>
        </div>
        <ul className="m-0 mt-2 grid list-none gap-0 p-0">
          {RESOLVED.map((plan, i) => (
            <li
              key={plan.name}
              data-shown={frame.curated}
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0 last:pb-0",
                reveal,
              )}
              style={{ transitionDelay: frame.curated ? `${150 + i * 160}ms` : "0ms" }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CheckCircle2 aria-hidden className="size-4 shrink-0 text-ok" strokeWidth={2.25} />
                <span className="min-w-0">
                  <span className="block truncate text-small font-semibold text-ink">{plan.name}</span>
                  <span className="sr-only">, verified. </span>
                  <span className="block truncate text-micro text-ink-3">{plan.kind}</span>
                </span>
              </span>
              <ChannelCombo channels={plan.channels} />
            </li>
          ))}
        </ul>
      </div>

      <div
        data-shown={frame.drafted}
        className={cn(reveal, "relative z-20 -mt-4 mr-3 rounded-lg border border-line-strong/70 bg-card p-4 shadow-xl sm:mr-8")}
      >
        <div className="flex items-center gap-2 text-small text-ink-2">
          <Mail aria-hidden className="size-4 text-teal" />
          <span className="truncate">
            Draft to <span className="font-semibold text-ink">intake@example.org</span>
          </span>
        </div>
        <p className="m-0 mt-2 line-clamp-2 text-small text-ink">
          Hello, I am writing to ask about a new-patient appointment for an adult with vascular Ehlers-Danlos
          syndrome.
        </p>
        <p className="m-0 mt-1 truncate text-micro text-ink-3">{AI_DISCLOSURE_EMAIL}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="m-0 text-small text-ink-2" aria-live="polite">
            {hasTriedApprove ? "Example only: nothing was sent." : "Waiting for your approval"}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setHasTriedApprove(true)}
            tabIndex={frame.drafted ? 0 : -1}
            className="border-teal/50 text-teal hover:border-teal hover:bg-teal-soft"
          >
            <Send aria-hidden />
            Approve &amp; send
          </Button>
        </div>
      </div>
    </figure>
  );
}
