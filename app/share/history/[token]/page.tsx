import { HistorySummaryView } from "@/components/history/summary/HistorySummaryView";
import { resolveShare } from "@/lib/history/share";

// Per-request: revocation and expiry must take effect immediately, and nothing here may be cached or indexed.
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shared medical history",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

/** Public page for a share link. No account, no case shell; shows only the sections the patient ticked. */
export default async function SharedHistoryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let resolved: Awaited<ReturnType<typeof resolveShare>> = null;
  try { resolved = await resolveShare(token, new Date()); } catch { resolved = null; }
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <main id="main" className="page-container py-section">
        {resolved ? (
          <HistorySummaryView
            summary={resolved.summary}
            titleLevel="h1"
            title="Shared medical history"
            intro={resolved.share.label ? `Shared for: ${resolved.share.label}` : "Shared by the patient."}
          />
        ) : (
          <section aria-labelledby="inactive" className="grid max-w-prose gap-3">
            <h1 id="inactive" className="m-0 font-display text-h1 font-light text-ink display-soft">This link is no longer active</h1>
            <p className="m-0 text-body text-ink-2">
              It may have expired or been turned off by the person who shared it. Ask them to send a new link if you still need it.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
