"use client";

import { readPlanStatus, type JourneyPlanStatus } from "@/components/journey/model";
import { agentsEmptyCopy } from "./empty-copy";
import { PendingFormQuestions } from "@/components/outreach/FormQuestionsCard";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, MessageSquare, Play } from "lucide-react";
import { Badge, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { AgentChat } from "./AgentChat";
import { CASE_SECTION_HEADING } from "@/components/outreach/CasePage";

const SectionH = CASE_SECTION_HEADING;
const POLL_MS = 5000;

type Channel = "email" | "call" | "web";
type InboxMode = "pending" | "own" | "shared" | "demo" | "none";

export type AgentEvent = {
  id: string;
  kind: string;
  action: string | null;
  reason: string | null;
  result: string | null;
  createdAt: string;
};

export type AgentView = {
  id: string;
  name: string;
  goal: string;
  strategy: Channel[];
  strategyStep: number;
  state: string;
  nextAction: string | null;
  nextActionAt: string | null;
  lastRunAt: string | null;
  inboxMode: InboxMode;
  inboxAddress: string | null;
  events: AgentEvent[];
  calls: { id: string; startedAt: string | null; outcome: string | null }[];
  applications: { id: string; status: string; url: string }[];
};

const GOAL_LABELS: Record<string, string> = {
  appointment: "Appointment",
  trial_screening: "Trial screening",
  membership: "Membership",
  aid_application: "Aid application",
};

const STATE_LABELS: Record<
  string,
  { label: string; tone: "neutral" | "teal" | "warn" | "ok" | "danger" }
> = {
  planning: { label: "Planning", tone: "neutral" },
  awaiting_approval: { label: "Needs your approval", tone: "teal" },
  waiting_reply: { label: "Waiting for a reply", tone: "neutral" },
  working: { label: "Working", tone: "teal" },
  escalated: { label: "Escalated", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
};

const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  call: "Call",
  web: "Web",
};

const humanize = (text: string) => text.replaceAll("_", " ");

export function relativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "now";
  const minutes = Math.round(abs / 60_000);
  const text =
    minutes < 60
      ? `${minutes}m`
      : minutes < 60 * 24
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / 1440)}d`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

function inboxLine(agent: AgentView): string {
  switch (agent.inboxMode) {
    case "own":
      return agent.inboxAddress
        ? `Own inbox: ${agent.inboxAddress}`
        : "Own inbox";
    case "shared":
      return "Case inbox (per-agent thread)";
    case "none":
      return "Mock mailer";
    case "demo":
      return "Test inbox (safe mode)";
    default:
      return "Inbox pending";
  }
}

function callsLine(agent: AgentView): string {
  if (agent.calls.length === 0) return "Calls: none";
  const last = agent.calls[agent.calls.length - 1];
  return `Calls: ${agent.calls.length}${last.outcome ? `, last ${humanize(last.outcome)}` : ""}`;
}

function applicationsLine(agent: AgentView): string {
  if (agent.applications.length === 0) return "Applications: none";
  const last = agent.applications[agent.applications.length - 1];
  return `Applications: ${agent.applications.length}, last ${humanize(last.status)}`;
}

function StrategyChips({
  strategy,
  step,
}: {
  strategy: Channel[];
  step: number;
}) {
  return (
    <ol
      className="m-0 flex list-none flex-wrap items-center gap-1 p-0"
      aria-label="Channel strategy"
    >
      {strategy.map((channel, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li
            key={`${channel}-${index}`}
            aria-current={current ? "step" : undefined}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-pill border px-2 text-small font-semibold",
              current &&
                "border-teal/25 bg-teal-soft text-teal-ink dark:text-teal",
              done && "border-line bg-transparent text-ink-3",
              !current && !done && "border-line-strong bg-paper-2 text-ink-2",
            )}
          >
            {done ? <Check aria-hidden className="size-3" /> : null}
            {CHANNEL_LABELS[channel]}
            {done ? <span className="sr-only"> (done)</span> : null}
            {current ? <span className="sr-only"> (current)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function AgentCard({
  agent,
  caseId,
  onRan,
  chatOpen,
  onToggleChat,
}: {
  agent: AgentView;
  caseId: string;
  onRan: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const [running, setRunning] = useState(false);
  const state = STATE_LABELS[agent.state] ?? {
    label: humanize(agent.state),
    tone: "neutral" as const,
  };
  const nextWhen = relativeTime(agent.nextActionAt);
  const events = agent.events.slice(0, 3);

  async function runNow() {
    setRunning(true);
    try {
      const response = await fetch(
        `/api/cases/${caseId}/agents/${agent.id}/run`,
        { method: "POST", credentials: "same-origin" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        skipped?: unknown;
      };
      if (!response.ok) {
        toast.error(
          typeof data.error === "string"
            ? data.error
            : "The agent could not run.",
        );
      } else if (data.skipped === "lease") {
        toast("Agent is already running");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setRunning(false);
      onRan();
    }
  }

  const details = (
    <div className="grid min-w-0 content-start gap-2.5">
      <header className="grid min-w-0 gap-1.5">
        <h3 className="m-0 min-w-0 truncate text-body font-semibold text-ink" title={agent.name}>
          {agent.name}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={state.tone}>{state.label}</Badge>
          <Badge tone="outline">
            {GOAL_LABELS[agent.goal] ?? humanize(agent.goal)}
          </Badge>
          <StrategyChips strategy={agent.strategy} step={agent.strategyStep} />
        </div>
      </header>
      {agent.nextAction ? (
        <p className="m-0 text-small text-ink">
          <span className="text-ink-2">Next: </span>
          {humanize(agent.nextAction)}
          {nextWhen ? <span className="text-ink-2"> · {nextWhen}</span> : null}
        </p>
      ) : null}
      <p className="m-0 text-small text-ink-2 [overflow-wrap:anywhere]">
        {inboxLine(agent)} · {callsLine(agent)} · {applicationsLine(agent)}
      </p>
      {agent.applications.some((a) => a.status === "draft") ? (
        <PendingFormQuestions caseId={caseId} applicationIds={agent.applications.filter((a) => a.status === "draft").map((a) => a.id)} />
      ) : null}
      {events.length > 0 ? (
        <ol
          className="m-0 grid list-none gap-1.5 border-t border-line p-0 pt-2.5 text-small"
          aria-label={`Recent events for ${agent.name}`}
        >
          {events.map((event) => (
            <li key={event.id} className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <code className="min-w-0 truncate font-mono text-small text-ink">
                  {event.action ?? event.kind}
                </code>
                <span className="ml-auto shrink-0 text-ink-3">
                  {relativeTime(event.createdAt)}
                </span>
              </div>
              {event.reason || event.result ? (
                <p className="m-0 line-clamp-2 text-ink-2">
                  {[event.reason, event.result].filter(Boolean).join(" → ")}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-0.5">
        <Button
          size="sm"
          variant="secondary"
          loading={running}
          loadingText="Running"
          aria-label={`Run now: ${agent.name}`}
          onClick={() => void runNow()}
        >
          <Play aria-hidden />
          Run now
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={chatOpen}
          aria-controls={`agent-chat-${agent.id}`}
          aria-label={`${chatOpen ? "Close chat with" : "Chat with"} ${agent.name}`}
          onClick={onToggleChat}
        >
          <MessageSquare aria-hidden />
          {chatOpen ? "Close chat" : "Chat"}
        </Button>
      </div>
    </div>
  );

  return (
    <li
      className={cn(
        "m-0 grid min-w-0 list-none content-start gap-4 rounded-lg border border-line bg-card p-4",
        // An open chat takes the whole row: details on the left, a roomy conversation on the right.
        chatOpen && "col-span-full lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-6",
      )}
      data-agent-state={agent.state}
    >
      {details}
      {chatOpen ? (
        <div
          id={`agent-chat-${agent.id}`}
          className="min-w-0 border-t border-line pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        >
          <AgentChat caseId={caseId} agentId={agent.id} agentName={agent.name} variant="judge" />
        </div>
      ) : null}
    </li>
  );
}

export function ResourceAgentsPanel({ caseId }: { caseId: string }) {
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [planStatus, setPlanStatus] = useState<JourneyPlanStatus | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/cases/${caseId}/agents`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { agents?: AgentView[] };
      const list = Array.isArray(data.agents) ? data.agents : [];
      setAgents(list);
      setFailed(false);
      if (list.length === 0) {
        // No agents yet: only say "start when you approve" if the plan really is not approved.
        const planResponse = await fetch(`/api/cases/${caseId}/plan?optional=1`, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
        setPlanStatus(planResponse?.ok ? readPlanStatus(await planResponse.json().catch(() => null)) : null);
      }
    } catch {
      setFailed(true);
    }
  }, [caseId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  return (
    <section aria-labelledby="resource-agents-heading" className="grid gap-3">
      <SectionH id="resource-agents-heading">Resource agents</SectionH>
      {agents === null && failed ? (
        <p className="m-0 text-small text-ink-2">
          Agents could not be loaded. Retrying.
        </p>
      ) : agents === null ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] gap-3"
          aria-busy="true"
        >
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="hidden h-40 w-full rounded-lg md:block" />
        </div>
      ) : agents.length === 0 ? (
        <p className="m-0 text-small text-ink-2">
          {agentsEmptyCopy(planStatus)}
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] grid-flow-row-dense gap-3 p-0">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              caseId={caseId}
              onRan={() => void load()}
              chatOpen={chatId === agent.id}
              onToggleChat={() => setChatId(chatId === agent.id ? null : agent.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
