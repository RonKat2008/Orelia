"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { JudgeOnly } from "@/components/view-mode/ViewOnly";
import { DEMO_CALL_SINK, DEMO_LABELS, isDemoFormUrl } from "@/lib/outreach/demo-destinations-shared";

/**
 * Demo destinations in effect (empty / disabled unless WAYFINDER_DEMO_COORDINATORS=1). Not secret: the addresses are
 * our own test inboxes / test phones and the reserved never-dialed demo sink.
 */
interface DemoDestinations {
  enabled: boolean;
  addresses: readonly string[];
  callsRingTestNumber: boolean;
}

const DemoCoordinatorsContext = createContext<DemoDestinations>({ enabled: false, addresses: [], callsRingTestNumber: false });

export function DemoCoordinatorsProvider({
  addresses,
  enabled = addresses.length > 0,
  callsRingTestNumber = false,
  children,
}: {
  addresses: readonly string[];
  enabled?: boolean;
  callsRingTestNumber?: boolean;
  children: ReactNode;
}) {
  const value = { enabled, addresses: addresses.map((a) => a.trim().toLowerCase()), callsRingTestNumber };
  return <DemoCoordinatorsContext.Provider value={value}>{children}</DemoCoordinatorsContext.Provider>;
}

export function useDemoDestinations(): DemoDestinations {
  return useContext(DemoCoordinatorsContext);
}

export function useIsDemoCoordinator(address: string | null | undefined): boolean {
  const { addresses } = useContext(DemoCoordinatorsContext);
  return !!address && addresses.includes(address.trim().toLowerCase());
}

/** Honest label for a demo-remapped destination, or null when the address/URL is a real one. */
export function demoDestinationLabel(address: string | null | undefined, demo: DemoDestinations): string | null {
  if (!address || !demo.enabled) return null;
  if (isDemoFormUrl(address)) return DEMO_LABELS.web_form;
  const normalized = address.trim().toLowerCase();
  if (normalized.replace(/[\s().-]/g, "") === DEMO_CALL_SINK) return DEMO_LABELS.voice;
  if (!demo.addresses.includes(normalized)) return null;
  if (!normalized.includes("@")) return DEMO_LABELS.voiceTestNumber;
  // The scripted coordinator lives on AgentMail; any other configured demo inbox is the presenter's own.
  return normalized.endsWith("@agentmail.to") ? DEMO_LABELS.email : DEMO_LABELS.emailPersonal;
}

/** Short, calm word for a demo-remapped destination ("Test inbox"); the full honest label stays for screen readers. */
export function shortDemoLabel(label: string): string {
  if (label === DEMO_LABELS.email) return "Test inbox";
  if (label === DEMO_LABELS.emailPersonal) return "Your inbox";
  if (label === DEMO_LABELS.voiceTestNumber) return "Test phone";
  if (label === DEMO_LABELS.voice) return "Simulated call";
  if (label === DEMO_LABELS.web_form) return "Test form";
  return "Test route";
}

const DEMO_TITLE =
  "Demo mode: the real contact point is shown in the plan, but delivery goes to Orelia's own test destination. No real organization is contacted.";

/**
 * Neutral outline badge for a demo-remapped label (docs/DESIGN-v2.md 4.1): judge view only, never coral. Visible text
 * is short ("Test inbox"); the full sentence is kept for screen readers and the tooltip so the label stays honest.
 */
export function DemoLabelBadge({ label }: { label: string }) {
  return (
    <JudgeOnly>
      <Badge tone="outline" title={DEMO_TITLE} data-demo-label="">
        {shortDemoLabel(label)}
        <span className="sr-only">. {label}.</span>
      </Badge>
    </JudgeOnly>
  );
}

/** Small badge next to any contact or application whose destination demo mode swapped for our own test one. */
export function DemoCoordinatorBadge({ address }: { address: string | null | undefined }) {
  const label = demoDestinationLabel(address, useDemoDestinations());
  if (!label) return null;
  return <DemoLabelBadge label={label} />;
}
