import { Eye } from "lucide-react";
import type { ActivityLane } from "@/lib/activity/types";

/** Only Kernel live view origins are ever embedded (the CSP allows the same set). */
export const isKernelLiveViewUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && /(^|\.)(onkernel\.com|kernel\.sh)$/.test(u.hostname);
  } catch {
    return false;
  }
};

const PHASE_TEXT = { filling: "Filling the form", submitting: "Submitting the approved form" } as const;

/** Judge view: the Kernel cloud browser, live and read-only, while it fills or submits an application. */
export function WatchAgent({ lane }: { lane: ActivityLane }) {
  const view = lane.liveView;
  if (!view || !isKernelLiveViewUrl(view.url)) return null;
  return (
    <section aria-labelledby="watch-agent-heading" className="grid min-w-0 gap-1.5 rounded-md border border-line bg-card p-2">
      <h2 id="watch-agent-heading" className="m-0 flex items-center gap-1.5 text-body font-semibold text-ink">
        <Eye aria-hidden className="size-4 text-teal" />
        Watch the agent: {PHASE_TEXT[view.phase]} for {lane.resourceName}
      </h2>
      <div className="aspect-[16/10] w-full overflow-hidden rounded-md border border-line-strong bg-paper-2">
        <iframe
          title={`Live: Kernel cloud browser on ${view.host}`}
          src={view.url}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          className="size-full border-0"
        />
      </div>
      <p className="m-0 text-small text-ink-2">Live: Kernel cloud browser on {view.host} (read-only)</p>
    </section>
  );
}
