import type { ReactNode } from "react";
import { SafetyBanner } from "@/components/SafetyBanner";
import { PageTransition } from "@/components/motion/PageTransition";
import { fontVariables } from "@/lib/motion/typography";
import "./styles/tokens.css";
import "./globals.css";

export const metadata = {
  title: "Wayfinder",
  description: "Find specialists, trials, advocacy, and aid, then get seen.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        {/* The safety notice sits outside the transition so it never moves or fades. */}
        <SafetyBanner />
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
