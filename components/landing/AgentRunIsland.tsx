"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { whenIdleAfterLoad } from "@/lib/ui/defer";

type PanelComponent = ComponentType<{ className?: string }>;

/**
 * Client island for the hero's agents panel. `children` is the server-rendered first
 * frame (AgentRunPanelView), so the panel paints with the HTML and costs no JS up front;
 * the animated panel, which starts from that same frame, loads once the page is idle.
 */
export function AgentRunIsland({ children }: { children: ReactNode }) {
  const [Panel, setPanel] = useState<PanelComponent | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const cancel = whenIdleAfterLoad(() => {
      import("./AgentRunPanel")
        .then((mod) => {
          if (!isCancelled) setPanel(() => mod.default);
        })
        .catch(() => {
          // The still first frame stays; it is a complete, labelled example.
        });
    });
    return () => {
      isCancelled = true;
      cancel();
    };
  }, []);

  return Panel ? <Panel /> : <>{children}</>;
}
