import { CaseDocumentsView } from "@/components/case-docs/CaseDocumentsView";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CaseDocumentsView caseId={id} />;
}
