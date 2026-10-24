"use client";

import "./lab.css";
import { useState } from "react";
import { MotionPreference } from "@/lib/motion/MotionPreference";
import { AgentCardMotion } from "../AgentCardMotion";
import { EvidenceReveal } from "../EvidenceReveal";
import { PageTransition } from "../PageTransition";
import { ScoreBar } from "../ScoreBar";
import { StaggerList } from "../StaggerList";
import { SwarmConstellation } from "../swarm/SwarmConstellation";
import { WaypointRoute } from "../WaypointRoute";
import { LAB_RESOURCES, LAB_WAYPOINTS, type LabResource } from "./mock-data";
import { useSwarmSimulation } from "./useSwarmSimulation";

type MotionMode = "system" | "reduced" | "full";
type Theme = "system" | "light" | "dark";

const MOTION_OVERRIDE: Record<MotionMode, boolean | null> = { system: null, reduced: true, full: false };

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

function rotate<T>(list: readonly T[]): T[] {
  return list.length < 2 ? [...list] : [...list.slice(1), list[0]];
}

function ResourceCard({ resource }: { resource: LabResource }) {
  return (
    <article className="lab-resource">
      <header>
        <p className="lab-resource__kind">{resource.kind}</p>
        <h3 className="lab-resource__name">{resource.name}</h3>
        <p className="lab-resource__detail">{resource.detail}</p>
      </header>
      <ScoreBar items={resource.breakdown} />
      <EvidenceReveal evidence={resource.evidence} />
    </article>
  );
}

function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="lab-segmented">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} data-checked={value === o.value ? "true" : "false"}>
          <input
            type="radio"
            name={legend}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function MotionLab() {
  const [motionMode, setMotionMode] = useState<MotionMode>("system");
  const [theme, setTheme] = useState<Theme>("system");
  const [resources, setResources] = useState<LabResource[]>(LAB_RESOURCES);
  const swarm = useSwarmSimulation();

  const handleTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  return (
    <MotionPreference reducedMotion={MOTION_OVERRIDE[motionMode]}>
      <PageTransition className="lab">
        <header className="lab-masthead">
          <div>
            <h1 className="lab-title">Motion lab</h1>
            <p className="lab-lede">
              Every Wayfinder motion component with sample data. Turn on reduced motion to check that each one shows
              its finished state at once.
            </p>
          </div>
          <div className="lab-controls">
            <Segmented
              legend="Motion"
              value={motionMode}
              onChange={setMotionMode}
              options={[
                { value: "system", label: "Follow system" },
                { value: "reduced", label: "Reduced" },
                { value: "full", label: "Full" },
              ]}
            />
            <Segmented
              legend="Theme"
              value={theme}
              onChange={handleTheme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Paper" },
                { value: "dark", label: "Ink" },
              ]}
            />
          </div>
        </header>

        <section className="lab-section" aria-labelledby="lab-swarm">
          <div className="lab-section__head">
            <h2 id="lab-swarm">Research swarm</h2>
            <div className="lab-actions">
              <button type="button" className="lab-button lab-button--primary" onClick={swarm.start}>
                {swarm.isRunning ? "Restart the run" : "Simulate swarm run"}
              </button>
              <button type="button" className="lab-button" onClick={swarm.reset}>
                Reset
              </button>
            </div>
          </div>
          <SwarmConstellation agents={swarm.agents} caseLabel="Synovial sarcoma" />
          <StaggerList
            className="lab-agent-grid"
            items={swarm.agents}
            getKey={(a) => a.name}
            reorder={false}
            aria-label="Agent cards"
            renderItem={(a) => <AgentCardMotion name={a.name} status={a.status} counts={a.counts} />}
          />
        </section>

        <section className="lab-section" aria-labelledby="lab-shortlist">
          <div className="lab-section__head">
            <h2 id="lab-shortlist">Shortlist</h2>
            <div className="lab-actions">
              <button type="button" className="lab-button" onClick={() => setResources((r) => rotate(r))}>
                Re-rank
              </button>
              <button
                type="button"
                className="lab-button"
                onClick={() => setResources((r) => (r.length > 1 ? r.slice(0, -1) : LAB_RESOURCES))}
              >
                {resources.length > 1 ? "Remove last" : "Restore all"}
              </button>
            </div>
          </div>
          <WaypointRoute waypoints={LAB_WAYPOINTS} label="Your shortlist covers four kinds of help" />
          <StaggerList
            as="ol"
            className="lab-resource-list"
            items={resources}
            getKey={(r) => r.id}
            aria-label="Ranked resources"
            renderItem={(r) => <ResourceCard resource={r} />}
          />
        </section>

        <footer className="lab-safety" role="note">
          Wayfinder finds and contacts people who can help. It does not give medical advice. If you have new or
          worsening symptoms, contact your care team or call 911.
        </footer>
      </PageTransition>
    </MotionPreference>
  );
}
