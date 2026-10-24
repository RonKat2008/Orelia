import { Suspense } from "react";
import { PageIntro } from "@/components/shortlist/PageIntro";
import { ShortlistSkeleton } from "@/components/shortlist/ShortlistSkeleton";
import { ShortlistView } from "@/components/shortlist/ShortlistView";

export default async function ShortlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <PageIntro
        eyebrow="Shortlist"
        title={
          <>
            Resources worth a closer <em className="emph">look</em>
          </>
        }
        lede="Grouped by the kind of help they offer. Every reason shows where it came from, and choosing a resource does not contact anyone yet. This is a list of who to ask, never advice about treatment."
      />
      <Suspense fallback={<ShortlistSkeleton />}>
        <ShortlistView caseId={id} />
      </Suspense>
    </div>
  );
}
