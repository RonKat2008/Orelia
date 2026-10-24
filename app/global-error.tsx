"use client";

import { WaypointArt } from "@/components/pitch/StateScreen";
import { Button } from "@/components/ui/button";
import { fontVariables } from "@/lib/ui/fonts";
import "./styles/theme.css";

/** Last-resort screen: replaces the root layout, so it brings its own html and body. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="bg-paper font-sans text-ink antialiased">
        <main className="ds-root grid min-h-dvh place-items-center p-6">
          <div className="grid max-w-prose justify-items-start gap-5">
            <WaypointArt variant="broken" />
            <h1 className="m-0 font-display text-h1 font-light display-soft text-balance">
              Wayfinder hit a <em className="emph">snag</em>
            </h1>
            <p className="m-0 text-lead text-ink-2">
              Nothing was sent to anyone. Reload to try again. If symptoms are urgent, contact your care team or call
              911.
            </p>
            <Button size="lg" onClick={reset}>
              Try again
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
