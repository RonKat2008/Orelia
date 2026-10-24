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
    <OutreachNav caseId={id} current="threads">
      <h1>Conversations</h1>
      <p className="lede">
        Each contact has one timeline: messages you approved, replies, and call transcripts. A task stays open until
        the task approval API confirms it.
      </p>
      <ThreadsView caseId={id} focusContactId={contact} />
    </OutreachNav>
  );
}
