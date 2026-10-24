import type { ReactNode } from "react";
import { JourneyShell } from "@/components/journey/JourneyShell";
import { DemoCoordinatorsProvider } from "@/components/outreach/DemoCoordinators";
import { demoDestinationInfo, sharedDemoAddresses } from "@/lib/outreach/demo-destinations";

export default async function CaseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demo = demoDestinationInfo(process.env);
  return (
    <DemoCoordinatorsProvider addresses={sharedDemoAddresses(process.env)} enabled={demo.enabled} callsRingTestNumber={demo.callsRingTestNumber}>
      <JourneyShell caseId={id}>{children}</JourneyShell>
    </DemoCoordinatorsProvider>
  );
}
