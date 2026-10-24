import { DocumentsPanel } from "@/components/case-docs/DocumentsPanel";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <DocumentsPanel caseId={id} />
    </div>
  );
}
