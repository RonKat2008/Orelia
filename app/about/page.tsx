import { AboutPitch } from "@/components/pitch/AboutPitch";

export const metadata = {
  title: "About Wayfinder",
  description: "Wayfinder gets you seen by the specialists, trials, advocacy groups, and aid programs you choose.",
};

export default function AboutPage() {
  return (
    <main className="shell pitch">
      <AboutPitch />
    </main>
  );
}
