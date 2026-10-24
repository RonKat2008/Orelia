import { PrintableSummary } from "@/components/history/summary/PrintableSummary";

export const metadata = { title: "Medical history summary" };

/** Content only: the case layout supplies the shell and the single <main id="main">. Owner-only via the guarded API. */
export default async function HistorySummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintableSummary caseId={id} />;
}
