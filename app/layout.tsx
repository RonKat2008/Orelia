import type { ReactNode } from "react";
import { SafetyBanner } from "@/components/SafetyBanner";
import "./globals.css";

export const metadata = {
  title: "Wayfinder",
  description: "Find specialists, trials, advocacy, and aid, then get seen.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SafetyBanner />
        {children}
      </body>
    </html>
  );
}
