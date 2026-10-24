import type { ReactNode } from "react";
import { JourneyShell } from "@/components/journey/JourneyShell";
import { DemoCoordinatorsProvider } from "@/components/outreach/DemoCoordinators";
import { demoCoordinatorInboxes } from "@/lib/outreach/demo-coordinators";

export default async function CaseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DemoCoordinatorsProvider addresses={demoCoordinatorInboxes(process.env)}>
      <JourneyShell caseId={id}>{children}</JourneyShell>
    </DemoCoordinatorsProvider>
  );
}
