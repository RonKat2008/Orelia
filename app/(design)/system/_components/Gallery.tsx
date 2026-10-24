"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, Bell, Inbox, Mail, Phone, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AvatarInitials,
  Badge,
  Button,
  Card,
  CardDescription,
  CardEyebrow,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  ChoiceRow,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  EvidenceBadge,
  Field,
  IconButton,
  Input,
  Kbd,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetClose,
  Skeleton,
  SourceChip,
  Stat,
  StatGroup,
  Stepper,
  Surface,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@/components/ui";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Section, SubHead } from "./Section";
import { JOURNEY } from "./tokens-data";

const FILTERS = [
  { value: "all", label: "All", count: 16 },
  { value: "clinics", label: "Clinics", count: 6 },
  { value: "trials", label: "Trials", count: 4 },
] as const;

function FilterDemo() {
  const [value, setValue] = useState<(typeof FILTERS)[number]["value"]>("all");
  return <SegmentedControl label="Filter the list" options={FILTERS} value={value} onValueChange={setValue} />;
}


function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-b border-line py-6 last:border-b-0 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-10">
      <p className="m-0 text-small font-semibold text-ink-2">{label}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function ActionsSection() {
  const [loading, setLoading] = useState(false);
  const fakeSend = () => {
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      toast.success("Email approved", { description: "Sent to the intake team at Mayo Clinic." });
    }, 1400);
  };

  return (
    <Section
      id="actions"
      index="05 / Actions"
      title="Buttons"
      intro="One primary per view. Hover lifts a pixel and deepens; press settles; focus draws a 2px ring off a paper gap. Loading keeps the label and announces itself."
    >
      <Row label="Variants">
        <Button>
          Approve and send <ArrowRight aria-hidden />
        </Button>
        <Button variant="secondary">Save draft</Button>
        <Button variant="ghost">Skip for now</Button>
        <Button variant="link">Why this specialist?</Button>
        <Button variant="danger">Delete case</Button>
      </Row>
      <Row label="Sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Row>
      <Row label="States">
        <Button loading={loading} loadingText="Sending" onClick={fakeSend}>
          <Mail aria-hidden /> Send (try me)
        </Button>
        <Button disabled>Disabled</Button>
        <Button variant="secondary" loading>
          Checking sources
        </Button>
      </Row>
      <Row label="Icon buttons">
        <IconButton label="Search">
          <Search aria-hidden />
        </IconButton>
        <IconButton label="Notifications" variant="secondary">
          <Bell aria-hidden />
        </IconButton>
        <IconButton label="Call intake" variant="primary">
          <Phone aria-hidden />
        </IconButton>
        <IconButton label="Dismiss" size="sm">
          <X aria-hidden />
        </IconButton>
      </Row>
    </Section>
  );
}

export function EvidenceSection() {
  return (
    <Section
      id="evidence"
      index="06 / Evidence"
      title="Badges, sources and evidence"
      intro="Trust is the product. Verified state is carried by icon shape and a word; evidence strength by a filled meter and a label. Neither relies on colour."
    >
      <Row label="Badges">
        <Badge>Neutral</Badge>
        <Badge tone="teal" dot>
          Recruiting
        </Badge>
        <Badge tone="sage">Accepts new patients</Badge>
        <Badge tone="gold">Best match</Badge>
        <Badge tone="accent">New</Badge>
        <Badge tone="ok">Replied</Badge>
        <Badge tone="warn">Awaiting approval</Badge>
        <Badge tone="danger">Bounced</Badge>
        <Badge tone="outline" size="md">
          Telehealth
        </Badge>
      </Row>
      <Row label="Source chips">
        <SourceChip url="https://www.mayoclinic.org/departments-centers/neurology" date="2026-10-21" verified />
        <SourceChip url="https://clinicaltrials.gov/study/NCT05123456" date="2026-10-02" verified title="Trial record" />
        <SourceChip url="https://forum.example-patients.org/thread/42" date="2025-12-11" verified={false} />
      </Row>
      <Row label="Evidence">
        <EvidenceBadge level="strong" sources={3} showHint />
        <EvidenceBadge level="moderate" sources={1} showHint />
        <EvidenceBadge level="limited" showHint />
        <EvidenceBadge level="unverified" showHint />
      </Row>
      <Row label="Avatars">
        <AvatarInitials name="Dr. Amara Okafor" size="lg" />
        <AvatarInitials name="Lucía Fernández" />
        <AvatarInitials name="NORD Patient Services" />
        <AvatarInitials name="Jae-won Park" size="sm" />
      </Row>
    </Section>
  );
}

export function SurfaceSection() {
  return (
    <Section
      id="surfaces"
      index="07 / Surfaces"
      title="Cards and surfaces"
      intro="Three heights. Inset sinks into the page, flat sits on it, raised lifts toward the reader. Interactive cards lift on hover and settle on press."
    >
      <div className="grid gap-5 md:grid-cols-3">
        <Surface variant="inset">
          <CardEyebrow>Inset</CardEyebrow>
          <p className="mt-2 text-body text-ink-2">
            &ldquo;Dr. Okafor runs the only adult clinic for this condition in the Midwest.&rdquo;
          </p>
          <div className="mt-4">
            <SourceChip url="https://www.mayoclinic.org/x" date="2026-10-21" verified />
          </div>
        </Surface>
        <Surface variant="flat">
          <CardEyebrow>Flat</CardEyebrow>
          <p className="mt-2 text-body text-ink-2">Most content. Card colour on paper with a hairline.</p>
        </Surface>
        <Surface variant="raised" interactive tabIndex={0}>
          <CardEyebrow>Raised · interactive</CardEyebrow>
          <p className="mt-2 text-body text-ink-2">The thing to look at first. Hover or focus me.</p>
        </Surface>
      </div>

      <Card variant="raised" padding="lg" className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <CardHeader>
            <div className="flex flex-wrap gap-2">
              <Badge tone="gold">
                <Sparkles aria-hidden /> Best match
              </Badge>
              <Badge tone="sage">Accepts new patients</Badge>
            </div>
            <CardTitle className="mt-2">Dr. Amara Okafor, Neuromuscular Clinic</CardTitle>
            <CardDescription>
              Sees adults with myasthenia gravis and related conditions. 40 minutes away. Accepts your insurance
              according to the clinic page.
            </CardDescription>
          </CardHeader>
          <div className="flex flex-wrap gap-2">
            <SourceChip url="https://www.mayoclinic.org/departments-centers/neurology" date="2026-10-21" verified />
            <SourceChip url="https://www.healthgrades.com/physician/dr-okafor" date="2026-09-30" verified={false} />
          </div>
          <CardFooter>
            <Button>Draft intake email</Button>
            <Button variant="ghost">Not for me</Button>
            <EvidenceBadge level="strong" sources={2} className="ml-auto" />
          </CardFooter>
        </div>
        <StatGroup className="content-start md:flex-col md:border-l md:border-line md:pl-8">
          <Stat label="Distance" value="40" hint="minutes by car" />
          <Stat label="Wait" value="3–5" hint="weeks, per the clinic" />
        </StatGroup>
      </Card>
    </Section>
  );
}

export function FormsSection() {
  const [email, setEmail] = useState("");
  const invalid = email.length > 0 && !email.includes("@");
  return (
    <Section
      id="forms"
      index="08 / Forms"
      title="Inputs and choices"
      intro="44px tall targets, labels always visible, hints before the control and errors after, wired with aria. Invalid fields change border, tint and text, not just colour."
    >
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="grid gap-6">
          <Field label="Condition" htmlFor="sg-condition" hint="As your doctor wrote it, if you know.">
            <Input id="sg-condition" placeholder="e.g. Myasthenia gravis" aria-describedby="sg-condition-hint" />
          </Field>
          <Field
            label="Email for replies"
            htmlFor="sg-email"
            error={invalid ? "That email looks incomplete. It needs an @." : undefined}
          >
            <Input
              id="sg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "sg-email-error" : undefined}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="What matters most to you?" htmlFor="sg-notes" optional>
            <Textarea id="sg-notes" placeholder="Shorter travel, a doctor who has seen this before, cost..." />
          </Field>
          <Field label="How far can you travel?" htmlFor="sg-distance">
            <Select defaultValue="50">
              <SelectTrigger id="sg-distance">
                <SelectValue placeholder="Choose a distance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">Within 10 miles</SelectItem>
                <SelectItem value="50">Within 50 miles</SelectItem>
                <SelectItem value="200">Within 200 miles</SelectItem>
                <SelectItem value="any">Anywhere, including telehealth</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Disabled" htmlFor="sg-disabled">
            <Input id="sg-disabled" disabled value="Filled by the Trials agent" readOnly />
          </Field>
        </div>
        <div className="grid content-start gap-6">
          <div>
            <SubHead>Checkbox rows</SubHead>
            <div className="grid gap-3">
              <ChoiceRow title="Specialists" description="Doctors and clinics that see adults with this condition.">
                <Checkbox defaultChecked aria-label="Specialists" />
              </ChoiceRow>
              <ChoiceRow title="Clinical trials" description="Studies recruiting now, near you or remote.">
                <Checkbox aria-label="Clinical trials" />
              </ChoiceRow>
            </div>
          </div>
          <div>
            <SubHead>Radio group</SubHead>
            <RadioGroup defaultValue="email" aria-label="How should we contact intake teams?">
              <ChoiceRow title="Email first" description="We draft, you approve each one.">
                <RadioGroupItem value="email" aria-label="Email first" />
              </ChoiceRow>
              <ChoiceRow title="Call first" description="An agent calls during office hours, after you approve.">
                <RadioGroupItem value="call" aria-label="Call first" />
              </ChoiceRow>
            </RadioGroup>
          </div>
          <div className="grid gap-4">
            <SubHead>Switch</SubHead>
            <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-card p-4">
              <Label htmlFor="sg-switch" className="grid gap-0.5">
                <span>Text me when a clinic replies</span>
                <span className="font-normal text-ink-2">Standard rates may apply.</span>
              </Label>
              <Switch id="sg-switch" defaultChecked />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

export function NavigationSection() {
  return (
    <Section
      id="navigation"
      index="09 / Navigation"
      title="Tabs, accordion and the journey"
      intro="The Stepper is the patient journey: a route of waypoints. Marker shape and hidden text carry the state for screen readers and colour-blind readers."
    >
      <div className="grid gap-12">
        <div>
          <SubHead>Stepper · horizontal (stacks on phones)</SubHead>
          <Stepper steps={JOURNEY} current={2} />
        </div>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SubHead>Tabs · underline</SubHead>
            <Tabs defaultValue="specialists">
              <TabsList>
                <TabsTrigger value="specialists">Specialists</TabsTrigger>
                <TabsTrigger value="trials">Trials</TabsTrigger>
                <TabsTrigger value="aid">Financial aid</TabsTrigger>
              </TabsList>
              <TabsContent value="specialists" className="text-body text-ink-2">
                Six clinics found, four confirmed on their own pages.
              </TabsContent>
              <TabsContent value="trials" className="text-body text-ink-2">
                Three trials recruiting; one accepts remote visits.
              </TabsContent>
              <TabsContent value="aid" className="text-body text-ink-2">
                Two programs may cover travel costs.
              </TabsContent>
            </Tabs>
            <div className="mt-8">
              <SubHead>Segmented control (filters, no panels)</SubHead>
              <FilterDemo />
            </div>
          </div>
          <div>
            <SubHead>Accordion</SubHead>
            <Accordion type="single" collapsible defaultValue="a">
              <AccordionItem value="a">
                <AccordionTrigger>Does Wayfinder give medical advice?</AccordionTrigger>
                <AccordionContent>
                  No. We find and contact resources, and show where every claim came from. Decisions about care stay
                  with you and your care team.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="b">
                <AccordionTrigger>Will anything be sent without me?</AccordionTrigger>
                <AccordionContent>Never. Every email and call waits for your approval.</AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
        <div>
          <SubHead>Stepper · vertical (case rail)</SubHead>
          <Stepper steps={JOURNEY} current={3} orientation="vertical" className="max-w-xs" />
        </div>
      </div>
    </Section>
  );
}

export function OverlaySection() {
  return (
    <Section
      id="overlays"
      index="10 / Overlays"
      title="Dialogs, sheets, popovers, tooltips and toasts"
      intro="Overlays are for decisions and detail, never for news. The Sheet is a swipeable bottom drawer on phones and a side panel on desktop."
    >
      <Row label="Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Review before sending</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send this email to Mayo Clinic intake?</DialogTitle>
              <DialogDescription>
                It includes your name, condition and the question about new-patient availability. Nothing else.
              </DialogDescription>
            </DialogHeader>
            <Surface variant="inset" padding="sm" className="text-small text-ink-2">
              &ldquo;Hello, I am an adult with myasthenia gravis looking for a neuromuscular specialist...&rdquo;
            </Surface>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Not yet</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={() => toast.success("Approved", { description: "We will send it within a minute." })}>
                  Approve and send
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Row>
      <Row label="Sheet">
        <Sheet
          title="Why we picked this trial"
          description="Three reasons, each with its source."
          trigger={<Button variant="secondary">Open sheet</Button>}
          footer={
            <SheetClose>
              <Button>Got it</Button>
            </SheetClose>
          }
        >
          <ul className="m-0 grid list-none gap-4 p-0 text-body">
            <li className="grid gap-2">
              Recruiting adults 18 to 75 with your diagnosis.
              <SourceChip url="https://clinicaltrials.gov/study/NCT05123456" date="2026-10-02" verified />
            </li>
            <li className="grid gap-2">
              Site in Rochester, 40 minutes away.
              <SourceChip url="https://clinicaltrials.gov/study/NCT05123456" date="2026-10-02" verified />
            </li>
          </ul>
        </Sheet>
      </Row>
      <Row label="Popover · Tooltip">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">What does verified mean?</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="m-0 flex items-center gap-2 font-semibold">
              <ShieldCheck aria-hidden className="size-4 text-ok" /> Verified
            </p>
            <p className="m-0 mt-1.5 text-small text-ink-2">
              An agent opened the page and found the claim written there, on the date shown.
            </p>
          </PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost">Hover or focus me</Button>
          </TooltipTrigger>
          <TooltipContent>Last checked 2 hours ago</TooltipContent>
        </Tooltip>
      </Row>
      <Row label="Toast">
        <Button variant="secondary" onClick={() => toast.success("Draft saved")}>
          Success
        </Button>
        <Button variant="secondary" onClick={() => toast.info("Two clinics replied", { description: "Open your inbox to read them." })}>
          Info
        </Button>
        <Button variant="secondary" onClick={() => toast.error("Could not reach the clinic", { description: "We will try again in an hour." })}>
          Error
        </Button>
      </Row>
    </Section>
  );
}

export function StatusSection() {
  return (
    <Section
      id="status"
      index="11 / Status"
      title="Progress, loading, empty and small things"
      intro="Waiting is part of the experience. Say what is happening and how far along it is; skeletons are hidden from assistive tech while the region is marked busy."
    >
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          <Progress label="Checking sources" value={3} max={5} valueText="3 of 5 checked" />
          <Progress label="Replies received" value={2} max={2} valueText="All replied" tone="ok" />
          <Progress label="Awaiting approval" value={1} max={4} valueText="1 of 4 approved" tone="warn" />
          <Separator className="my-2" />
          <div role="status" aria-busy="true" aria-label="Loading results" className="grid gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-32 rounded-pill" />
              <Skeleton className="h-7 w-24 rounded-pill" />
            </div>
          </div>
          <p className="m-0 text-small text-ink-2">
            Search anything with <Kbd>⌘</Kbd> <Kbd>K</Kbd>, close with <Kbd>Esc</Kbd>.
          </p>
        </div>
        <EmptyState
          icon={<Inbox />}
          title="No replies yet"
          description="Clinics usually answer within two business days. We will let you know the moment one does."
          action={<Button variant="secondary">Review what was sent</Button>}
        />
      </div>
    </Section>
  );
}
