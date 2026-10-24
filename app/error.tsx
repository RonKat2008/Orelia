"use client";

import Link from "next/link";
import { EditorialPage } from "@/components/pitch/Editorial";
import { StateScreen, WaypointArt } from "@/components/pitch/StateScreen";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EditorialPage>
      <StateScreen
        eyebrow="Something went wrong"
        title={
          <>
            That did not <em className="emph">load</em>
          </>
        }
        description="This is on our side, and nothing was sent to anyone. Try again, or go back to the start."
        art={<WaypointArt variant="broken" />}
        actions={
          <>
            <Button size="lg" onClick={reset}>
              Try again
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/">Back to the start</Link>
            </Button>
          </>
        }
      />
      {error.digest ? (
        <p className="page-container m-0 py-4 font-mono text-mono text-ink-3">Reference: {error.digest}</p>
      ) : null}
    </EditorialPage>
  );
}
