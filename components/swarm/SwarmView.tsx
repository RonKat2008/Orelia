"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StaggerList } from "@/components/motion/StaggerList";
import { SwarmConstellation } from "@/components/motion/swarm/SwarmConstellation";
import type { SwarmAgent } from "@/lib/motion/status";
import { AgentCard, countsFor } from "./AgentCard";
import {
  applySwarmEvent,
  initialAgents,
  parseSwarmEvent,
  playMockStream,
  type AgentCardState,
} from "./stream";

function toSwarmAgents(cards: AgentCardState[]): SwarmAgent[] {
  return cards.map((card) => ({ name: card.agent, status: card.status, counts: countsFor(card) }));
}

export function SwarmView({ caseId }: { caseId: string }) {
  const [cards, setCards] = useState<AgentCardState[]>(initialAgents);
  const [source, setSource] = useState<"live" | "preview">("live");

  useEffect(() => {
    let stopMock = () => {};
    let sawEvent = false;
    let previewing = false;
    const stream = new EventSource(`/api/cases/${caseId}/stream`);

    const startPreview = () => {
      if (previewing || sawEvent) return;
      previewing = true;
      stream.close();
      setSource("preview");
      setCards(initialAgents());
      stopMock = playMockStream((event) => {
        setCards((current) => applySwarmEvent(current, event));
      });
    };

    stream.onmessage = (message) => {
      const event = parseSwarmEvent(message.data);
      if (!event) return;
      sawEvent = true;
      setCards((current) => applySwarmEvent(current, event));
    };
    stream.onerror = () => {
      if (!sawEvent) startPreview();
    };

    const giveUp = window.setTimeout(() => {
      if (!sawEvent) startPreview();
    }, 1200);

    return () => {
      window.clearTimeout(giveUp);
      stream.close();
      stopMock();
    };
  }, [caseId]);

  const finished = cards.every((card) => card.status !== "queued" && card.status !== "running");

  return (
    <div className="stack" aria-busy={!finished} aria-live="polite">
      <p className="notice">
        {source === "preview"
          ? "Showing a typed preview of the research swarm. The live stream connects when the research service is available."
          : "Live updates from the research swarm."}
      </p>
      <SwarmConstellation agents={toSwarmAgents(cards)} />
      <h2 className="swarm-cards-heading">What each search returned</h2>
      <StaggerList
        className="cards"
        items={cards}
        getKey={(card) => card.agent}
        reorder={false}
        aria-label="Research agents"
        renderItem={(card) => <AgentCard card={card} />}
      />
      {finished ? (
        <div className="row">
          <Link className="button" href={`/cases/${caseId}/shortlist`}>
            Review the shortlist
          </Link>
        </div>
      ) : null}
    </div>
  );
}
