import { notFound } from "next/navigation";
import { demoEnabled } from "@/app/api/demo/lib/guard";
import { DemoPanel } from "@/components/demo/DemoPanel";
import { RunFullDemo } from "@/components/demo/RunFullDemo";
import { liveDemoEnabled } from "@/lib/demo-live/start";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Demo control",
  description: "Seed the fictional Wayfinder demo and rehearse scripted replies.",
};

/**
 * Demo control. Live demo (WAYFINDER_DEMO_COORDINATORS=1 with an allowlisted coordinator inbox): "Run full demo".
 * Rehearsal panel (WAYFINDER_DEMO=1, dry-run, local only): the scripted-reply panel. 404 when neither is on.
 */
export default function DemoPage() {
  const live = liveDemoEnabled(process.env);
  const rehearsal = demoEnabled(process.env);
  if (!live && !rehearsal) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      {live ? (
        <section aria-labelledby="live-demo-h" className="flex flex-col gap-2">
          <h1 id="live-demo-h" className="m-0 font-display text-2xl">Live demo</h1>
          <RunFullDemo />
        </section>
      ) : null}
      {rehearsal ? <DemoPanel /> : null}
    </div>
  );
}
