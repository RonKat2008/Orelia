import { OutreachNav } from "@/components/outreach/OutreachNav";
import { ThreadsView } from "@/components/threads/ThreadsView";

export default async function ThreadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ contact?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const contact = typeof query.contact === "string" ? query.contact : null;
  return (
    <OutreachNav
      caseId={id}
      current="threads"
      eyebrow="Messages and calls"
      title={
        <>
          The whole <em className="emph">conversation</em>
        </>
      }
      lede="Messages you approved, replies, and call transcripts, in order. Anything a contact asks of you shows up right where they asked."
    >
      <ThreadsView caseId={id} focusContactId={contact} />
    </OutreachNav>
  );
}
