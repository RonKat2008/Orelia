import { AboutPitch } from "@/components/pitch/AboutPitch";
import { SiteFooter, SiteHeader } from "@/components/shell";

export const metadata = {
  title: "About Wayfinder",
  description: "Wayfinder gets you seen by the specialists, trials, advocacy groups, and aid programs you choose.",
};

export default function AboutPage() {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main id="main">
        <AboutPitch />
      </main>
      <SiteFooter />
    </div>
  );
}
