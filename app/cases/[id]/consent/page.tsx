import { ConsentForm } from "@/components/outreach/ConsentForm";
import { OutreachNav } from "@/components/outreach/OutreachNav";
import { PREVIEW_CASE, PREVIEW_CONTACTS } from "@/components/outreach/preview";

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav caseId={id} current="consent">
      <h1>What each contact may see</h1>
      <p className="lede">
        Diagnosis starts selected. Everything else stays private until you tick it. The list under each contact is
        the exact text a draft is allowed to include. This preview uses a synthetic case, not a patient record.
      </p>
      <ConsentForm caseId={id} caseRecord={PREVIEW_CASE} contacts={PREVIEW_CONTACTS} />
    </OutreachNav>
  );
}
