"use client";

import { useId, useState } from "react";
import {
  ActionCard,
  Badge,
  Button,
  Checkbox,
  CheckedMark,
  EmptyState,
  List,
  ListRow,
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui";

/** Compact v2 specimen (list + action card + empty state), rendered once per theme. */
function V2Specimen({ theme }: { theme: "light" | "dark" }) {
  const uid = useId();
  const pickId = `${uid}-pick`;
  const [picked, setPicked] = useState(true);
  const [answer, setAnswer] = useState("yes");

  return (
    <div data-theme={theme} className="grain min-w-0 rounded-lg border border-line bg-paper p-5 text-ink sm:p-8">
      <p className="m-0 mb-5 font-mono text-mono text-ink-3">{theme === "light" ? "Clear Day" : "Night"} · v2</p>
      <div className="grid min-w-0 gap-6">
        <List label={`People who may help (${theme})`}>
          <ListRow
            title="Stanford EDS Clinic"
            meta="Clinic · Palo Alto, CA · Email"
            leading={
              <Checkbox id={pickId} checked={picked} onCheckedChange={(v) => setPicked(v === true)} aria-label="Pick Stanford EDS Clinic" />
            }
            selectId={pickId}
            badges={[<Badge key="t" tone="teal">Good match</Badge>]}
          >
            <CheckedMark sources={3} />
          </ListRow>
          <ListRow title="Dr. Amara Osei" meta="Specialist · Boston, MA · Phone" href="#v2" badges={[<Badge key="w" tone="warn">Your turn</Badge>]} />
        </List>
        <ActionCard
          titleAs="h3"
          title="Can we tell them your city?"
          lede="It helps them find care near you."
          action={<Button size="lg">Continue</Button>}
          secondaryAction={<Button variant="link">Skip for now</Button>}
          reassurance="Only what you say yes to is shared."
        >
          <RadioGroup value={answer} onValueChange={setAnswer} aria-label={`Share your city (${theme})`}>
            {["yes", "no"].map((v) => (
              <label key={v} htmlFor={`${uid}-${v}`} className="flex min-h-11 items-center gap-3 text-body">
                <RadioGroupItem id={`${uid}-${v}`} value={v} />
                {v === "yes" ? "Yes, share it" : "No, keep it private"}
              </label>
            ))}
          </RadioGroup>
        </ActionCard>
        <EmptyState titleAs="h3" title="Replies will show here" description="We'll add them when someone answers." />
      </div>
    </div>
  );
}

export function V2Pair() {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <V2Specimen theme="light" />
      <V2Specimen theme="dark" />
    </div>
  );
}
