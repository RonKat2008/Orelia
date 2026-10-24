"use client";

import { useId, useState, type ReactNode } from "react";
import {
  ActionCard,
  BackLink,
  Badge,
  Button,
  Checkbox,
  CheckedMark,
  ConfirmDialog,
  Details,
  EmptyState,
  ErrorSummary,
  Input,
  JudgeOnly,
  List,
  ListRow,
  LoadingState,
  PageHeader,
  PatientOnly,
  PATIENT_BADGE_TONES,
  Question,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  SummaryList,
  TwoPane,
} from "@/components/ui";
import { Section, SubHead } from "./Section";
import { V2Pair } from "./V2Specimen";

function Demo({ title, rule, children }: { title: string; rule: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-3 border-t border-line pt-6">
      <SubHead>{title}</SubHead>
      <p className="m-0 max-w-prose text-small text-ink-2">{rule}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ButtonsDemo() {
  return (
    <Demo title="Buttons" rule="One primary per view, at most one quiet secondary, links for the rest. Danger-ghost only for Delete case.">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button>Send this email</Button>
        <Button variant="secondary">Edit first</Button>
        <Button variant="link">See sources</Button>
        <Button variant="danger-ghost">Delete case</Button>
      </div>
    </Demo>
  );
}

function ListDemo() {
  const uid = useId();
  const pickId = `${uid}-pick`;
  const [picked, setPicked] = useState(false);
  const [sel, setSel] = useState("b");
  return (
    <Demo title="List and ListRow" rule="Rows, not boxes. One badge at most per row; static facts go in plain text; one Checked mark per item.">
      <List label="People who may help">
        <ListRow
          title="Stanford EDS Clinic"
          meta="Clinic · Palo Alto, CA · Email"
          leading={<Checkbox id={pickId} checked={picked} onCheckedChange={(v) => setPicked(v === true)} aria-label="Pick Stanford EDS Clinic" />}
          selectId={pickId}
          badges={[<Badge key="t" tone="teal">Good match</Badge>]}
        />
        <ListRow
          title="Dr. Amara Osei"
          meta="Specialist · Boston, MA · Phone"
          href="#v2"
          badges={[<Badge key="w" tone="warn">Your turn</Badge>]}
          trailing={<span>Mon 27 Oct</span>}
        />
        <ListRow
          title="Genetics Center, UCSF"
          meta="Clinic · San Francisco, CA · Email"
          onSelect={() => setSel(sel === "c" ? "b" : "c")}
          selected={sel === "c"}
          badges={[<Badge key="o" tone="ok">Replied</Badge>]}
        >
          <CheckedMark sources={3} />
          <Details summary="Why this one?" label={null}>
            They see adults with your diagnosis and answered similar requests within a week.
          </Details>
        </ListRow>
      </List>
    </Demo>
  );
}

function ActionCardDemo() {
  const uid = useId();
  const [answer, setAnswer] = useState("");
  return (
    <Demo title="ActionCard" rule="The one 'do this now' block per view: question, one primary, one quiet link, one reassurance line.">
      <ActionCard
        titleAs="h3"
        title="Can we tell them your city?"
        lede="It helps them find care near you."
        action={<Button size="lg">Continue</Button>}
        secondaryAction={<Button variant="link">Skip for now</Button>}
        reassurance="Only what you say yes to is shared."
      >
        <RadioGroup value={answer} onValueChange={setAnswer} aria-label="Share your city">
          {[
            ["yes", "Yes, share it"],
            ["no", "No, keep it private"],
          ].map(([v, text]) => (
            <label key={v} htmlFor={`${uid}-${v}`} className="flex min-h-11 items-center gap-3 text-body">
              <RadioGroupItem id={`${uid}-${v}`} value={v} />
              {text}
            </label>
          ))}
        </RadioGroup>
      </ActionCard>
    </Demo>
  );
}

function HeaderDemo() {
  return (
    <Demo title="PageHeader and BackLink" rule="One title and one sentence of lede. Renders h1 by default; h2 here because this page already has an h1.">
      <div className="grid min-w-0 gap-2">
        <BackLink href="#v2">Back to your case</BackLink>
        <PageHeader as="h2" title="Choose who we contact" lede="We found 16. You can pick up to 5." />
      </div>
    </Demo>
  );
}

function DetailsDemo() {
  return (
    <Demo title="Details" rule="One level of disclosure, labelled, never nested. Closed content is skipped by Tab.">
      <Details summary="what each detail is used for">
        Your city finds nearby clinics. Your diagnosis picks the right specialists. Nothing else is shared.
      </Details>
    </Demo>
  );
}

const PEOPLE = [
  { id: "a", name: "Stanford EDS Clinic", meta: "Clinic · Palo Alto, CA", note: "Sees adults. Accepts new patients." },
  { id: "b", name: "Dr. Amara Osei", meta: "Specialist · Boston, MA", note: "Runs a genetics practice." },
  { id: "c", name: "Genetics Center, UCSF", meta: "Clinic · San Francisco, CA", note: "Replied within a week." },
  { id: "d", name: "Mayo Clinic Rochester", meta: "Hospital · Rochester, MN", note: "Referral needed." },
];

function TwoPaneDemo() {
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const current = PEOPLE.find((p) => p.id === sel);
  return (
    <Demo title="TwoPane" rule="Judge list and detail. Below 1024 px the detail opens in a sheet. Press j and k to move between rows.">
      <TwoPane
        listLabel="Shortlist"
        detailLabel="Selected contact"
        list={
          <List>
            {PEOPLE.map((p) => (
              <ListRow
                key={p.id}
                title={p.name}
                meta={p.meta}
                selected={sel === p.id}
                onSelect={() => {
                  setSel(p.id);
                  setOpen(true);
                }}
              />
            ))}
          </List>
        }
        detail={
          current ? (
            <div className="grid gap-2">
              <h3 className="m-0 font-display text-h3 font-normal text-ink">{current.name}</h3>
              <p className="m-0 text-small text-ink-2">{current.meta}</p>
              <p className="m-0 text-body text-ink-2">{current.note}</p>
            </div>
          ) : null
        }
        emptyDetail={<EmptyState titleAs="h3" title="Pick a contact" description="Its sources and score show here." />}
        detailOpen={open}
        onDetailOpenChange={setOpen}
        detailTitle={current?.name}
        detailFooter={<Button onClick={() => setOpen(false)}>Add to contacts</Button>}
      />
    </Demo>
  );
}

const CONTACTS = [
  ["email", "Email"],
  ["phone", "Phone"],
] as const;

function QuestionsDemo() {
  const uid = useId();
  const cityId = `${uid}-city`;
  const [city, setCity] = useState("");
  const [cityError, setCityError] = useState<string>();
  const [contact, setContact] = useState("");
  const [contactError, setContactError] = useState<string>();
  return (
    <Demo title="Question, ErrorSummary and SummaryList" rule="One question per page. Validate on Continue, never on blur; Continue is never disabled. Plain-language errors say how to fix it.">
      <div className="grid min-w-0 gap-10">
        <Question
          kind="fieldset"
          questionAs="h2"
          controlId={`${uid}-contact`}
          question="How should they reach you?"
          hint="Pick one."
          error={contactError}
          onSubmit={() => setContactError(contact ? undefined : "Choose email or phone")}
        >
          <RadioGroup value={contact} onValueChange={setContact} aria-label="How should they reach you?">
            {CONTACTS.map(([v, text]) => (
              <label key={v} htmlFor={`${uid}-c-${v}`} className="flex min-h-11 items-center gap-3 text-body">
                <RadioGroupItem id={`${uid}-c-${v}`} value={v} />
                {text}
              </label>
            ))}
          </RadioGroup>
        </Question>
        <Question
          questionAs="h2"
          controlId={cityId}
          question="What city do you live in?"
          hint="We use it to find care near you."
          error={cityError}
          back={<BackLink href="#v2">Back</BackLink>}
          onSubmit={() => setCityError(city.trim() ? undefined : "Tell us your city, or choose Skip")}
          secondary={<Button variant="link" type="button">Skip for now</Button>}
        >
          {(q) => <Input id={cityId} value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" {...q} />}
        </Question>
        <div className="grid min-w-0 gap-3">
          <p className="m-0 text-small font-semibold text-ink">Check your answers</p>
          <SummaryList
            rows={[
              { label: "Your city", value: city || "Boston", changeHref: "#v2" },
              { label: "Contact by", value: contact || "Email", changeHref: "#v2" },
              { label: "Your phone number", value: "", changeHref: "#v2" },
            ]}
          />
        </div>
        <div className="grid min-w-0 gap-3">
          <p className="m-0 text-small text-ink-2">ErrorSummary on its own:</p>
          <ErrorSummary autoFocus={false} errors={[{ fieldId: cityId, message: "Tell us your city, or choose Skip" }]} />
        </div>
      </div>
    </Demo>
  );
}

function StatesDemo() {
  return (
    <Demo title="EmptyState, LoadingState and ConfirmDialog" rule="Empty is quiet, never red. Loading mirrors the page and says so after 3 s. Confirm asks a question and offers a safe way out.">
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        <EmptyState titleAs="h3" title="Replies will show here" description="We'll add them when someone answers." action={<Button variant="link">Choose who to contact</Button>} />
        <LoadingState label="Loading your case">
          <div className="grid gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </LoadingState>
      </div>
      <div className="mt-6">
        <ConfirmDialog
          trigger={<Button variant="danger-ghost">Delete case</Button>}
          title="Delete this case?"
          description="This removes your case and everything we found. You can't undo it."
          confirmLabel="Delete case"
          cancelLabel="Keep it"
          onConfirm={() => undefined}
        />
      </div>
    </Demo>
  );
}

function ViewDemo() {
  return (
    <Demo title="JudgeOnly and PatientOnly" rule="Hydration-safe view switches. Use the view toggle in the header to flip between them.">
      <div className="grid gap-2 text-body text-ink">
        <PatientOnly>
          <p className="m-0">Patient view is active: plain words, one next step.</p>
        </PatientOnly>
        <JudgeOnly>
          <p className="m-0">Judge view is active: scores, sources and agent traces.</p>
        </JudgeOnly>
      </div>
    </Demo>
  );
}

function BadgesDemo() {
  return (
    <Demo title="Badges" rule="Patient view uses only these four tones, one per row. Static facts are plain text, not badges.">
      <div className="flex flex-wrap items-center gap-3">
        {PATIENT_BADGE_TONES.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>
    </Demo>
  );
}

export function V2Section() {
  return (
    <Section
      id="v2"
      index="12 / v2 primitives"
      title="Fewer boxes, one clear next step."
      intro="The v2 set from DESIGN-v2: one primary action per view, a badge budget (1 in patient view, 2 in judge view), lists for comparable items and cards only for the one decision. Copy is plain language. Every demo is live."
    >
      <div className="grid min-w-0 gap-10">
        <ButtonsDemo />
        <ListDemo />
        <ActionCardDemo />
        <HeaderDemo />
        <DetailsDemo />
        <TwoPaneDemo />
        <QuestionsDemo />
        <StatesDemo />
        <ViewDemo />
        <BadgesDemo />
        <Demo title="Both themes" rule="The same v2 set with the theme forced on a wrapper through data-theme.">
          <V2Pair />
        </Demo>
      </div>
    </Section>
  );
}
