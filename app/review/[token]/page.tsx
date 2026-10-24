import type { Metadata } from "next";
import { ReviewForm } from "@/components/coordinate/ReviewForm";
import { Wordmark } from "@/components/shell/Wordmark";

export const metadata: Metadata = {
  title: "Review a request",
  description: "A private page for a doctor to review a request on behalf of a patient.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Public, token-gated page outside the case layout: its own minimal chrome and the only <main>. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <header className="border-b border-line">
        <div className="page-container flex items-center justify-between py-4">
          <Wordmark href="/" />
          <p className="m-0 text-small text-ink-3">Private review page</p>
        </div>
      </header>
      <main id="main" className="page-container grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-8 py-10">
        <h1 className="m-0 font-display text-h1 font-light text-balance text-ink display-soft">Review a request for <em className="emph">your patient</em></h1>
        <ReviewForm token={token} />
      </main>
    </div>
  );
}
