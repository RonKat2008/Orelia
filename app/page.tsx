import type { Metadata } from "next";
import { FinalCta } from "@/components/landing/FinalCta";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { NeverSection } from "@/components/landing/NeverSection";
import { START_HREF } from "@/components/landing/content";
import { LenisProvider } from "@/components/shell/LenisProvider";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";

export const metadata: Metadata = {
  title: "Wayfinder: find the experts, get seen",
  description:
    "For adults with a rare disease. We find specialists, studies, patient groups and aid, check every claim against its source, and reach out for you after you approve each message.",
};

export default function LandingPage() {
  return (
    <LenisProvider>
      <div className="ds-root">
        <SiteHeader cta={{ href: START_HREF, label: "Start your case" }} viewToggle ctaHideWhileVisible="[data-hero]" />
        <main id="main">
          <Hero />
          <HowItWorks />
          <NeverSection />
          <FinalCta />
        </main>
        <SiteFooter />
      </div>
    </LenisProvider>
  );
}
