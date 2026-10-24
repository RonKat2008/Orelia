import { CaseHome } from "@/components/journey/CaseHome";

export default async function CaseHomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseHome caseId={id} />;
}
