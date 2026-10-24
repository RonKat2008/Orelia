import { ConsentForm } from "@/components/outreach/ConsentForm";
import { OutreachNav } from "@/components/outreach/OutreachNav";

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav
      caseId={id}
      current="consent"
      eyebrow="Before anyone is contacted"
      title={
        <>
          You choose what each contact <em className="emph">sees</em>
        </>
      }
      lede="Everything starts private except your diagnosis. Tick only what a contact needs. Nothing is sent from this page, and you will read and approve every message first."
    >
      <ConsentForm caseId={id} />
    </OutreachNav>
  );
}
