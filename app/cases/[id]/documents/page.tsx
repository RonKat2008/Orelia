import { DocumentsPanel } from "@/components/case-docs/DocumentsPanel";
import { PageIntro } from "@/components/shortlist/PageIntro";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <PageIntro
        eyebrow="Documents"
        title={
          <>
            What outreach can <em className="emph">draw on</em>
          </>
        }
        lede="Grouped by kind. The intake report is never sent. Other items say which field you have consented to share, or that they are public resource information. Nothing here is a treatment recommendation."
      />
      <DocumentsPanel caseId={id} />
    </div>
  );
}
