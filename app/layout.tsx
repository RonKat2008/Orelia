import type { ReactNode } from "react";
import { SafetyBanner } from "@/components/SafetyBanner";
import { PageTransition } from "@/components/motion/PageTransition";
import { Providers } from "@/components/shell/Providers";
import { SERIF_BOOT_SCRIPT, SERIF_NOSCRIPT_CSS, THEME_BOOT_SCRIPT } from "@/components/shell/theme-script";
import { fontVariables } from "@/lib/ui/fonts";
// theme.css loads Tailwind, the Warm Paper tokens and (layered) the legacy
// tokens.css + globals.css, so it is the only global stylesheet import.
import "./styles/theme.css";

export const metadata = {
  title: "Orelia",
  description: "Find specialists, trials, advocacy, and aid, then get seen.",
};

export const viewport = {
  themeColor: "#fbfcfd",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // White theme by default; THEME_BOOT_SCRIPT swaps in a stored choice before paint.
    <html lang="en" className={fontVariables} data-theme="light" suppressHydrationWarning>
      <head>
        {/* Static, first-party string (no user input): applies the saved theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Static, first-party strings: load the display serif after first paint (theme-script.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SERIF_BOOT_SCRIPT }} />
        <noscript>
          <style dangerouslySetInnerHTML={{ __html: SERIF_NOSCRIPT_CSS }} />
        </noscript>
      </head>
      <body className="bg-paper font-sans text-ink antialiased">
        <Providers>
          {/* The safety notice sits outside the transition so it never moves or fades. Its landmark keeps every
              piece of content inside a region (axe "region"). */}
          <section aria-label="Safety notice">
            <SafetyBanner />
          </section>
          <PageTransition>{children}</PageTransition>
        </Providers>
      </body>
    </html>
  );
}
