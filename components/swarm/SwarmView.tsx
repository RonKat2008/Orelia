"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentCard } from "./AgentCard";
import {
  applySwarmEvent,
  initialAgents,
  parseSwarmEvent,
  playMockStream,
  type AgentCardState,
} from "./stream";

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
    <div className="stack">
      <p className="notice">
        {source === "preview"
          ? "Showing a typed preview of the research swarm. The live stream connects when the research service is available."
          : "Live updates from the research swarm."}
      </p>
      <div className="cards">
        {cards.map((card) => (
          <AgentCard key={card.agent} card={card} />
        ))}
      </div>
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
