'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, FileText, Files, Mail, ShieldCheck, Stethoscope, FileQuestion, type LucideIcon } from 'lucide-react';
import { Badge, Button, Card, Input, Label, Skeleton, toast } from '@/components/ui';
import { cn } from '@/lib/ui/cn';
import { checkRequirements, getChecklists, setRequirement } from './client';
import { REQUIREMENT_KIND_LABELS, REQUIREMENT_STATUS_LABELS, REQUIREMENT_STATUS_ORDER, checklistProgress } from './model';
import { Live, PanelHeading, Reveal, SourceLink } from './shared';
import type { ReferralRequirement, RequirementKind, RequirementStatus, RequirementsChecklist, Resource } from './types';

const KIND_ICONS: Record<RequirementKind, LucideIcon> = {
  referral_letter: Mail,
  records: Files,
  insurance_preauth: ShieldCheck,
  intake_form: FileText,
  econsult: Stethoscope,
  other: FileQuestion,
};

export function RequirementsPanel({ caseId, resources }: { caseId: string; resources: Resource[] }) {
  const [lists, setLists] = useState<Record<string, RequirementsChecklist>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await getChecklists(caseId);
    if (res.ok) setLists(Object.fromEntries(res.data.map(l => [l.resourceKey, l])));
    else setMessage(res.message);
    setLoading(false);
  }, [caseId]);
  useEffect(() => {
    let live = true;
    void getChecklists(caseId).then(res => {
      if (!live) return;
      if (res.ok) setLists(Object.fromEntries(res.data.map(l => [l.resourceKey, l])));
      else setMessage(res.message);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [caseId]);

  const check = async (resourceKey?: string) => {
    setBusyKey(resourceKey ?? '*');
    setMessage('Reading each center’s public pages. This can take a moment.');
    const res = await checkRequirements(caseId, resourceKey);
    setBusyKey(null);
    if (res.ok) {
      setLists(prev => ({ ...prev, ...Object.fromEntries(res.data.map(l => [l.resourceKey, l])) }));
      setMessage('Requirements updated.');
    } else {
      setMessage(res.message);
      toast.error(res.message);
    }
  };

  const update = async (list: RequirementsChecklist, req: ReferralRequirement, status: RequirementStatus, note?: string) => {
    const res = await setRequirement(caseId, list.resourceKey, list.version, req.id, status, note);
    if (res.ok) {
      setLists(prev => ({ ...prev, [list.resourceKey]: res.data }));
      setMessage('Saved.');
    } else if (res.status === 409) {
      toast.info('This list changed elsewhere, reloading.');
      await load();
    } else {
      setMessage(res.message);
      toast.error(res.message);
    }
  };

  return (
    <section aria-labelledby="req-heading" className="grid gap-6">
      <PanelHeading
        id="req-heading"
        eyebrow="Referral checklist"
        title="What each place asks for before they see you"
        lede="We read each center’s public pages for things like referral letters, records and forms. Every item links to the page it came from. Please check the source before you rely on it."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void check()} loading={busyKey === '*'} loadingText="Checking" disabled={resources.length === 0 || busyKey !== null}>
          <ClipboardCheck aria-hidden /> Check requirements
        </Button>
        <Live>{message}</Live>
      </div>
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      {resources.map((r, i) => (
        <Reveal key={r.resourceKey} index={i}>
          <ResourceChecklist
            resource={r}
            list={lists[r.resourceKey]}
            busy={busyKey === r.resourceKey || busyKey === '*'}
            onCheck={() => void check(r.resourceKey)}
            onUpdate={update}
          />
        </Reveal>
      ))}
    </section>
  );
}

function ResourceChecklist({ resource, list, busy, onCheck, onUpdate }: {
  resource: Resource;
  list?: RequirementsChecklist;
  busy: boolean;
  onCheck: () => void;
  onUpdate: (l: RequirementsChecklist, r: ReferralRequirement, s: RequirementStatus, note?: string) => Promise<void>;
}) {
  const progress = list ? checklistProgress(list.requirements.map(r => r.status)) : null;
  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="m-0 font-display text-h4 font-normal text-ink">{resource.name}</h4>
        <div className="flex items-center gap-2">
          {progress && progress.total > 0 ? <Badge tone="teal">{progress.have} of {progress.total} ready</Badge> : null}
          <Button size="sm" variant="ghost" onClick={onCheck} loading={busy} loadingText="Checking">
            {list ? 'Check again' : 'Check'}
          </Button>
        </div>
      </div>
      {!list ? (
        <p className="m-0 text-body text-ink-2">Not checked yet.</p>
      ) : list.requirements.length === 0 ? (
        <p className="m-0 text-body text-ink-2">
          {list.unavailableReason ?? 'We did not find published requirements for this place. You can call or email them to ask what they need.'}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {list.requirements.map(req => (
            <RequirementRow key={req.id} req={req} onChange={(s, note) => onUpdate(list, req, s, note)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RequirementRow({ req, onChange }: { req: ReferralRequirement; onChange: (s: RequirementStatus, note?: string) => Promise<void> }) {
  const Icon = KIND_ICONS[req.kind];
  const [note, setNote] = useState(req.note ?? '');
  const noteId = `note-${req.id}`;
  return (
    <li className="grid gap-3 rounded-md border border-line bg-paper-2/60 p-4">
      <div className="flex items-start gap-3">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" />
        <div className="grid min-w-0 gap-1">
          <p className="m-0 font-semibold text-ink">
            {req.label} <span className="font-normal text-ink-3">· {REQUIREMENT_KIND_LABELS[req.kind]}</span>
          </p>
          {req.detail ? <p className="m-0 text-small text-ink-2 text-pretty">{req.detail}</p> : null}
          <SourceLink url={req.sourceUrl} />
        </div>
      </div>
      <div role="group" aria-label={`Status for ${req.label}`} className="flex flex-wrap gap-2">
        {REQUIREMENT_STATUS_ORDER.map(s => (
          <button
            key={s}
            type="button"
            aria-pressed={req.status === s}
            onClick={() => void onChange(s, note || undefined)}
            className={cn(
              'min-h-10 rounded-pill border px-3.5 text-small font-semibold focus-ring transition-colors motion-reduce:transition-none',
              req.status === s ? 'border-teal bg-teal text-on-teal' : 'border-line-strong bg-card text-ink-2 hover:border-ink-3 hover:text-ink',
            )}
          >
            {REQUIREMENT_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>Note <span className="font-normal text-ink-3">(optional)</span></Label>
        <Input
          id={noteId}
          value={note}
          maxLength={400}
          placeholder="For example, asked Dr. Lee on Oct 2"
          onChange={e => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (req.note ?? '')) void onChange(req.status, note);
          }}
        />
      </div>
    </li>
  );
}
