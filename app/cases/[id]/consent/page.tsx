import { ConsentForm } from "@/components/outreach/ConsentForm";
import { OutreachNav } from "@/components/outreach/OutreachNav";

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav caseId={id} current="consent">
      <h1>What each contact may see</h1>
      <p className="lede">
        Diagnosis starts selected. Everything else stays private until you tick it. Saving writes those fields to the
        server for each contact. A resource with channel none cannot be sent anything.
      </p>
      <ConsentForm caseId={id} />
    </OutreachNav>
  );
}
