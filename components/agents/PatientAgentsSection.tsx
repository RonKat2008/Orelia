"use client";

import { useEffect, useState } from "react";
import { AgentChat } from "./AgentChat";
import { Button } from "@/components/ui";

type PatientAgent = { id: string; name: string; state: string };

const PLAIN_STATUS: Record<string, string> = {
  awaiting_approval: "Waiting for your OK",
  waiting_reply: "Waiting to hear back",
  working: "Working on it",
  escalated: "Needs you",
  done: "Done",
};

/** Compact "Your agents" list for the patient tracker: plain status plus an inline message box. */
export function PatientAgentsSection({ caseId }: { caseId: string }) {
  const [agents, setAgents] = useState<PatientAgent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/cases/${caseId}/agents`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { agents?: PatientAgent[] };
        if (active && Array.isArray(data.agents)) setAgents(data.agents);
      } catch {
        // The section simply stays hidden.
      }
    })();
    return () => {
      active = false;
    };
  }, [caseId]);

  if (agents.length === 0) return null;

  return (
    <section aria-labelledby="patient-agents-heading" className="grid gap-3" data-testid="patient-agents">
      <h2 id="patient-agents-heading" className="m-0 text-h3 font-semibold text-ink">
        Your agents
      </h2>
      <ul className="m-0 grid list-none gap-3 p-0">
        {agents.map((agent) => {
          const open = openId === agent.id;
          const panelId = `agent-chat-${agent.id}`;
          return (
            <li key={agent.id} className="m-0 grid list-none gap-2 rounded-lg border border-line bg-card p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-body font-semibold text-ink [overflow-wrap:anywhere]">{agent.name}</p>
                  <p className="m-0 text-small text-ink-2">{PLAIN_STATUS[agent.state] ?? "Getting started"}</p>
                </div>
                <Button
                  size="lg"
                  variant="secondary"
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={`${open ? "Close message to" : "Message"} ${agent.name}`}
                  onClick={() => setOpenId(open ? null : agent.id)}
                >
                  {open ? "Close" : "Message"}
                </Button>
              </div>
              {open ? (
                <div id={panelId}>
                  <AgentChat caseId={caseId} agentId={agent.id} agentName={agent.name} variant="patient" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
