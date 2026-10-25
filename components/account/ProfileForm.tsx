"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { goalSchema } from "@/lib/contracts/case";
import {
  CONTACT_PREFERENCES,
  SEX_AT_BIRTH,
  profileSchema,
  type Profile,
} from "@/lib/accounts/contract";
import { US_STATES } from "@/lib/safety/us-states";
import { GOAL_HINTS, GOAL_LABELS, type Goal } from "@/components/intake/goals";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Field, Label, Textarea } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { AccountGate } from "./AccountGate";
import { Callout, SECTION_TITLE, TextField } from "./FormBits";
import { ErrorSummary } from "@/components/ui/error-summary";
import { LoadingState } from "@/components/ui/states";
import { apiRequest } from "./helpers/api";

type TextKey =
  | "preferredName" | "legalName" | "dateOfBirth" | "city" | "zip" | "phone" | "insurer" | "plan" | "memberId"
  | "pcpName" | "pcpPractice" | "primaryDiagnosis" | "diagnosedOn" | "otherConditions" | "medications"
  | "allergies" | "preferredLanguage" | "travelLimitMiles";

interface FormState extends Record<TextKey, string> {
  sexAtBirth: string;
  state: string;
  contactPreference: string;
  goals: Goal[];
}

const UNSET = "unset";
const SEX_LABELS: Record<(typeof SEX_AT_BIRTH)[number], string> = {
  female: "Female", male: "Male", intersex: "Intersex", prefer_not_to_say: "Prefer not to say",
};
const CONTACT_LABELS: Record<(typeof CONTACT_PREFERENCES)[number], string> = { email: "Email", phone: "Phone call", text: "Text message" };
const STATE_OPTIONS = Object.entries(US_STATES).map(([code, name]) => ({
  code,
  label: `${code} · ${name.replace(/\b\w/g, (c) => c.toUpperCase())}`,
}));

const EMPTY: FormState = {
  preferredName: "", legalName: "", dateOfBirth: "", sexAtBirth: "", city: "", state: "", zip: "", phone: "",
  insurer: "", plan: "", memberId: "", pcpName: "", pcpPractice: "", primaryDiagnosis: "", diagnosedOn: "",
  otherConditions: "", medications: "", allergies: "", preferredLanguage: "", contactPreference: "",
  travelLimitMiles: "", goals: [],
};

function fromProfile(profile: Profile | null): FormState {
  if (!profile) return EMPTY;
  return {
    ...EMPTY,
    ...Object.fromEntries(
      (Object.keys(EMPTY) as (keyof FormState)[])
        .filter((key) => key !== "goals" && key !== "travelLimitMiles")
        .map((key) => [key, String(profile[key as keyof Profile] ?? "")]),
    ),
    travelLimitMiles: profile.travelLimitMiles === undefined ? "" : String(profile.travelLimitMiles),
    goals: profile.goals ?? [],
  };
}

function toInput(form: FormState): Record<string, unknown> {
  const miles = form.travelLimitMiles.trim();
  return {
    ...form,
    sexAtBirth: form.sexAtBirth || undefined,
    contactPreference: form.contactPreference || undefined,
    travelLimitMiles: miles === "" ? undefined : Number(miles),
    goals: form.goals,
  };
}

const SECTION_TITLES = [
  "About you",
  "Where you live",
  "Insurance",
  "Your care team",
  "Your condition",
  "Medications & allergies",
  "Preferences",
] as const;

interface SectionProps {
  title: (typeof SECTION_TITLES)[number];
  description?: ReactNode;
  children: ReactNode;
}

/** One profile section: every section is on the page at once (no step-by-step Back / Next), fields in columns. */
function Section({ title, description, children }: SectionProps) {
  const index = SECTION_TITLES.indexOf(title);
  return (
    <section
      aria-label={title}
      data-section={index}
      className="grid grid-cols-1 gap-3 border-t border-line pt-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10"
    >
      <div className="grid content-start gap-1">
        <h2 className={SECTION_TITLE}>{title}</h2>
        {description ? <p className="m-0 text-small text-ink-2 text-pretty">{description}</p> : null}
      </div>
      <div className="grid min-w-0 content-start gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>.wide]:sm:col-span-2 [&>.wide]:lg:col-span-3">
        {children}
      </div>
    </section>
  );
}

function ProfileBody() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adultOnly, setAdultOnly] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let live = true;
    void apiRequest<{ profile: Profile | null }>("/api/account/profile").then((res) => {
      if (!live) return;
      if (res.ok) setForm(fromProfile(res.data?.profile ?? null));
      else setLoadError(res.message ?? "We could not load your profile. Refresh to try again.");
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const text = (key: TextKey) => ({ value: form[key], onValueChange: (v: string) => set(key, v), error: errors[key], id: `pf-${key}` });

  function focusFirstError(fieldErrors: Record<string, string>) {
    const first = Object.keys(fieldErrors)[0];
    if (!first) return;
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`#pf-${first}`)?.focus());
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setAdultOnly(null);
    setFormError(null);
    const parsed = profileSchema.safeParse(toInput(form));
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      setFormError("Fix the fields below, then save again");
      return;
    }
    setErrors({});
    setSaving(true);
    const res = await apiRequest<{ profile: Profile }>("/api/account/profile", { method: "PUT", json: parsed.data });
    setSaving(false);
    if (res.ok) {
      if (res.data?.profile) setForm(fromProfile(res.data.profile));
      toast.success("Profile saved");
      return;
    }
    if (res.status === 422 && res.error === "adult_only") {
      setAdultOnly(res.message ?? "Orelia is built for adults (18 and over).");
      focusFirstError({ dateOfBirth: "" });
      return;
    }
    if (res.status === 422 && res.issues.length > 0) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of res.issues) {
        const key = issue.path.split(".")[0] ?? "";
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      setFormError("Fix the fields below, then save again");
      return;
    }
    setFormError(res.message ?? "We could not save your profile. Please try again.");
  }

  if (!loaded) {
    return (
      <LoadingState label="Loading your profile">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </LoadingState>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-5">
            {formError && Object.keys(errors).length > 0 ? (
        <ErrorSummary
          errors={Object.entries(errors).map(([key, message]) => ({ fieldId: `pf-${key}`, message }))}
        />
      ) : null}
      {loadError ? <Callout tone="danger" role="alert">{loadError}</Callout> : null}

      <Section title="About you" description="Your preferred name is how Orelia addresses you.">
        <TextField {...text("preferredName")} label="Preferred name" autoComplete="nickname" required />
        <TextField {...text("legalName")} label="Legal name" optional autoComplete="name" />
        <TextField
          {...text("dateOfBirth")}
          label="Date of birth"
          type="date"
          autoComplete="bday"
          hint="Orelia is for adults (18+)."
          required
          error={errors.dateOfBirth}
        />
        <Field label="Sex at birth" htmlFor="pf-sexAtBirth" optional>
          <Select value={form.sexAtBirth || UNSET} onValueChange={(v) => set("sexAtBirth", v === UNSET ? "" : v)}>
            <SelectTrigger id="pf-sexAtBirth"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Not specified</SelectItem>
              {SEX_AT_BIRTH.map((v) => <SelectItem key={v} value={v}>{SEX_LABELS[v]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {adultOnly ? <Callout tone="warn" role="alert" className="wide">{adultOnly}</Callout> : null}
      </Section>

      <Section title="Where you live" description="Helps find care within reach.">
        <TextField {...text("city")} label="City" optional autoComplete="address-level2" />
        <Field label="State" htmlFor="pf-state" optional error={errors.state}>
          <Select value={form.state || UNSET} onValueChange={(v) => set("state", v === UNSET ? "" : v)}>
            <SelectTrigger id="pf-state"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Not specified</SelectItem>
              {STATE_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <TextField {...text("zip")} label="ZIP code" optional autoComplete="postal-code" inputMode="numeric" />
        <TextField {...text("phone")} label="Phone" optional type="tel" autoComplete="tel" />
      </Section>

      <Section title="Insurance" description="Optional. Used to find programs and centers that take your plan.">
        <TextField {...text("insurer")} label="Insurer" optional />
        <TextField {...text("plan")} label="Plan" optional />
        <TextField {...text("memberId")} label="Member ID" optional autoComplete="off" />
      </Section>

      <Section title="Your care team">
        <TextField {...text("pcpName")} label="Primary care clinician" optional />
        <TextField {...text("pcpPractice")} label="Practice or clinic" optional />
      </Section>

      <Section title="Your condition">
        <TextField {...text("primaryDiagnosis")} label="Primary diagnosis" optional fieldClassName="wide" />
        <TextField {...text("diagnosedOn")} label="Diagnosed on" optional placeholder="YYYY, YYYY-MM or YYYY-MM-DD" />
        <Field label="Other conditions" htmlFor="pf-otherConditions" optional error={errors.otherConditions} className="wide">
          <Textarea
            id="pf-otherConditions"
            value={form.otherConditions}
            onChange={(e) => set("otherConditions", e.target.value)}
            aria-invalid={errors.otherConditions ? true : undefined}
            aria-describedby={errors.otherConditions ? "pf-otherConditions-error" : undefined}
          />
        </Field>
      </Section>

      <Section title="Medications & allergies" description="For your own reference. Orelia never gives medical advice.">
        <Field label="Medications" htmlFor="pf-medications" optional error={errors.medications} className="wide">
          <Textarea
            id="pf-medications"
            value={form.medications}
            onChange={(e) => set("medications", e.target.value)}
            aria-invalid={errors.medications ? true : undefined}
            aria-describedby={errors.medications ? "pf-medications-error" : undefined}
          />
        </Field>
        <Field label="Allergies" htmlFor="pf-allergies" optional error={errors.allergies} className="wide">
          <Textarea
            id="pf-allergies"
            rows={3}
            value={form.allergies}
            onChange={(e) => set("allergies", e.target.value)}
            aria-invalid={errors.allergies ? true : undefined}
            aria-describedby={errors.allergies ? "pf-allergies-error" : undefined}
          />
        </Field>
      </Section>

      <Section title="Preferences">
        <TextField {...text("preferredLanguage")} label="Preferred language" optional />
        <Field label="Best way to reach you" htmlFor="pf-contactPreference" optional>
          <Select value={form.contactPreference || UNSET} onValueChange={(v) => set("contactPreference", v === UNSET ? "" : v)}>
            <SelectTrigger id="pf-contactPreference"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>No preference</SelectItem>
              {CONTACT_PREFERENCES.map((v) => <SelectItem key={v} value={v}>{CONTACT_LABELS[v]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <TextField
          {...text("travelLimitMiles")}
          label="Farthest you would travel (miles)"
          optional
          type="number"
          inputMode="numeric"
          min={0}
          max={5000}
        />
        <fieldset className="wide m-0 grid min-w-0 gap-3 border-0 p-0">
          <legend className="mb-1 p-0 text-small font-semibold text-ink">What you are looking for</legend>
          {goalSchema.options.map((goal) => {
            const checked = form.goals.includes(goal);
            return (
              <div key={goal} className="flex items-start gap-3">
                <Checkbox
                  id={`pf-goal-${goal}`}
                  checked={checked}
                  onCheckedChange={(next) =>
                    set("goals", next === true ? [...form.goals, goal] : form.goals.filter((g) => g !== goal))
                  }
                  className="mt-0.5"
                />
                <Label htmlFor={`pf-goal-${goal}`} className="grid cursor-pointer gap-0.5">
                  <span>{GOAL_LABELS[goal]}</span>
                  <span className="text-small font-normal text-ink-2">{GOAL_HINTS[goal]}</span>
                </Label>
              </div>
            );
          })}
        </fieldset>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-4 border-t border-line bg-paper px-1 py-3">
        <Button type="submit" size="lg" loading={saving} loadingText="Saving">Save profile</Button>
        {formError && Object.keys(errors).length === 0 ? <p role="alert" className="m-0 text-small font-semibold text-danger">{formError}</p> : null}
      </div>
    </form>
  );
}

export function ProfileForm() {
  return <AccountGate path="/account/profile">{() => <ProfileBody />}</AccountGate>;
}
