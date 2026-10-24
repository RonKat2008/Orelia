"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DEMO_COORDINATOR_LABEL } from "@/lib/outreach/demo-coordinators";

/** Demo coordinator inbox addresses in effect (empty unless WAYFINDER_DEMO_COORDINATORS=1). Not secret. */
const DemoCoordinatorsContext = createContext<readonly string[]>([]);

export function DemoCoordinatorsProvider({ addresses, children }: { addresses: readonly string[]; children: ReactNode }) {
  return <DemoCoordinatorsContext.Provider value={addresses}>{children}</DemoCoordinatorsContext.Provider>;
}

export function useIsDemoCoordinator(address: string | null | undefined): boolean {
  const list = useContext(DemoCoordinatorsContext);
  return !!address && list.includes(address.trim().toLowerCase());
}

/** Small badge shown next to any contact that is one of our synthetic demo intake coordinators. */
export function DemoCoordinatorBadge({ address }: { address: string | null | undefined }) {
  if (!useIsDemoCoordinator(address)) return null;
  return (
    <Badge
      tone="accent"
      title="A synthetic intake coordinator played by our own test inbox. No real organization is contacted in demo mode."
    >
      {DEMO_COORDINATOR_LABEL}
    </Badge>
  );
}
