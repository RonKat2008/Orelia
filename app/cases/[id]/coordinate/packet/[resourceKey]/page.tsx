import { PacketPrint } from "@/components/coordinate/PacketPrint";

/** Content only (the case layout provides the shell and the only <main>). Chrome is hidden when printing. */
export default async function PacketPrintPage({ params }: { params: Promise<{ id: string; resourceKey: string }> }) {
  const { id, resourceKey } = await params;
  return <PacketPrint caseId={id} resourceKey={resourceKey} />;
}
