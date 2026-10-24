import { notFound } from "next/navigation";
import { demoEnabled } from "@/app/api/demo/lib/guard";
import { DemoPanel } from "@/components/demo/DemoPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Demo control",
  description: "Seed the fictional Wayfinder demo and rehearse scripted replies.",
};

export default function DemoPage() {
  if (!demoEnabled(process.env)) notFound();
  return (
    <DemoPanel />
  );
}
