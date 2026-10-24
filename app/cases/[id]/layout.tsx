import type { ReactNode } from "react";
import { JourneyShell } from "@/components/journey/JourneyShell";

export default async function CaseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JourneyShell caseId={id}>{children}</JourneyShell>;
}
