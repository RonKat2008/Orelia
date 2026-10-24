import type { ReactNode } from "react";
import { SafetyBanner } from "@/components/SafetyBanner";
import { PageTransition } from "@/components/motion/PageTransition";
import { Providers } from "@/components/shell/Providers";
import { THEME_BOOT_SCRIPT } from "@/components/shell/theme-script";
import { fontVariables } from "@/lib/ui/fonts";
// theme.css loads Tailwind, the Warm Paper tokens and (layered) the legacy
// tokens.css + globals.css, so it is the only global stylesheet import.
import "./styles/theme.css";

export const metadata = {
  title: "Wayfinder",
  description: "Find specialists, trials, advocacy, and aid, then get seen.",
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6ef" },
    { media: "(prefers-color-scheme: dark)", color: "#141a19" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set before paint by THEME_BOOT_SCRIPT, so the server markup can differ.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Static, first-party string (no user input): applies the saved theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-paper font-sans text-ink antialiased">
        <Providers>
          {/* The safety notice sits outside the transition so it never moves or fades. */}
          <SafetyBanner />
          <PageTransition>{children}</PageTransition>
        </Providers>
      </body>
    </html>
  );
}
