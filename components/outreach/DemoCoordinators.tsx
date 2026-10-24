"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
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
  return normalized.includes("@") ? DEMO_LABELS.email : DEMO_LABELS.voiceTestNumber;
}

/** Small badge next to any contact or application whose destination demo mode swapped for our own test one. */
export function DemoCoordinatorBadge({ address }: { address: string | null | undefined }) {
  const label = demoDestinationLabel(address, useDemoDestinations());
  if (!label) return null;
  return (
    <Badge tone="accent" title="Demo mode: the real contact point is shown in the plan, but delivery goes to Wayfinder's own test destination. No real organization is contacted.">
      {label}
    </Badge>
  );
}
