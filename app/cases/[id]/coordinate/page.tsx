import { CoordinateView } from "@/components/coordinate/CoordinateView";
import { OutreachNav } from "@/components/outreach/OutreachNav";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function CoordinatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav
      caseId={id}
      current="coordinate"
      eyebrow="Working with your doctors"
      title={
        <>
          Coordinate your <em className="emph">care</em> team
        </>
      }
      lede="See what each place needs, prepare a short packet, and ask your own doctor to reach an expert for you. We explain and organize. We never give medical advice, and nothing is sent without your say."
    >
      <CoordinateView caseId={id} />
    </OutreachNav>
  );
}
