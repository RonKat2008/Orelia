import { BadgeCheck, CircleDashed, Sprout } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EvidenceLevel } from "@/lib/condition-brief/contract";
import { LEVEL_LABEL } from "./model";

const ICON = { established: BadgeCheck, emerging: Sprout, uncertain: CircleDashed } as const;
const TONE = { established: "ok", emerging: "gold", uncertain: "outline" } as const;

/** Evidence level as words plus an icon shape; colour is never the only signal. */
export function EvidenceMarker({ level }: { level: EvidenceLevel }) {
  const Icon = ICON[level];
  return (
    <Badge tone={TONE[level]} data-level={level}>
      <Icon aria-hidden />
      <span className="sr-only">Evidence level: </span>
      {LEVEL_LABEL[level]}
    </Badge>
  );
}
