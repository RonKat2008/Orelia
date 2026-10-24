import type { Metadata } from "next";
import { FinalCta } from "@/components/landing/FinalCta";
import { FindsBento } from "@/components/landing/FindsBento";
import { Hero } from "@/components/landing/Hero";
import { HowItAdapts } from "@/components/landing/HowItAdapts";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingChoreography } from "@/components/landing/LandingChoreography";
import { ProblemSection } from "@/components/landing/ProblemSection";
import { TrustSection } from "@/components/landing/TrustSection";
import { START_HREF } from "@/components/landing/content";
import { LenisProvider } from "@/components/shell/LenisProvider";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";

export const metadata: Metadata = {
  title: "Wayfinder: find the experts, get seen",
  description:
    "For adults with a rare disease: research agents find specialists, trials, advocacy groups and aid, check every claim against its source, then call, email or apply online for you, only after you approve each message, and follow up.",
};

export default function LandingPage() {
  return (
    <LenisProvider>
      <div className="ds-root">
        <SiteHeader cta={{ href: START_HREF, label: "Start your case" }} />
        <main id="main">
          <Hero />
          <ProblemSection />
          <HowItWorks />
          <HowItAdapts />
          <TrustSection />
          <FindsBento />
          <FinalCta />
        </main>
        <SiteFooter />
        <LandingChoreography />
      </div>
    </LenisProvider>
  );
}
