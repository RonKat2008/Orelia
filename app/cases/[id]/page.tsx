import { CaseHomeSwitch } from "@/components/patient/CaseHomeSwitch";

export default async function CaseHomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseHomeSwitch caseId={id} />;
}
