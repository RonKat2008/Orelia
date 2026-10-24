'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardCheck, FileText, Files, Mail, ShieldCheck, Stethoscope, FileQuestion, type LucideIcon } from 'lucide-react';
import { Button, Details, Input, Label, List, ListRow, Skeleton, toast } from '@/components/ui';
import { cn } from '@/lib/ui/cn';
import { checkRequirements, getChecklists, setRequirement } from './client';
import { REQUIREMENT_KIND_LABELS, REQUIREMENT_STATUS_LABELS, REQUIREMENT_STATUS_ORDER, checklistProgress } from './model';
import type { SectionFocusProps } from './focus';
import { Live, PanelHeading, SourceLink } from './shared';
import type { ReferralRequirement, RequirementKind, RequirementStatus, RequirementsChecklist, Resource } from './types';

const KIND_ICONS: Record<RequirementKind, LucideIcon> = {
  referral_letter: Mail,
  records: Files,
  insurance_preauth: ShieldCheck,
  intake_form: FileText,
  econsult: Stethoscope,
  other: FileQuestion,
};

export function RequirementsPanel({ caseId, resources, primary, onNeeds }: { caseId: string; resources: Resource[] } & SectionFocusProps) {
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

  useEffect(() => {
    if (!loading) onNeeds(resources.some(r => !lists[r.resourceKey]));
  }, [loading, lists, resources, onNeeds]);

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
        title="What each place asks for before they see you"
        lede="We read each center’s public pages. Every item links to its source, so please check it before you rely on it."
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button
          variant={primary ? 'primary' : 'link'}
          className={primary ? undefined : 'min-h-11'}
          onClick={() => void check()}
          loading={busyKey === '*'}
          loadingText="Checking"
          disabled={resources.length === 0 || busyKey !== null}
        >
          <ClipboardCheck aria-hidden /> Check requirements
        </Button>
        <Live>{message}</Live>
      </div>
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      {resources.map(r => (
        <ResourceChecklist
          key={r.resourceKey}
          resource={r}
          list={lists[r.resourceKey]}
          busy={busyKey === r.resourceKey || busyKey === '*'}
          onCheck={() => void check(r.resourceKey)}
          onUpdate={update}
        />
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
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="m-0 min-w-0 break-words text-body font-semibold text-ink">
          {resource.name}
          {progress && progress.total > 0 ? <span className="font-normal text-ink-2"> · {progress.have} of {progress.total} ready</span> : null}
        </h4>
        <Button size="sm" variant="link" className="min-h-11" onClick={onCheck} loading={busy} loadingText="Checking">
          {list ? 'Check again' : 'Check'}<span className="sr-only"> {resource.name}</span>
        </Button>
      </div>
      {!list ? (
        <p className="m-0 text-body text-ink-2">Not checked yet.</p>
      ) : list.requirements.length === 0 ? (
        <p className="m-0 text-body text-ink-2">
          {list.unavailableReason ?? 'We did not find published requirements for this place. You can call or email them to ask what they need.'}
        </p>
      ) : (
        <List label={`Requirements for ${resource.name}`}>
          {list.requirements.map(req => (
            <RequirementRow key={req.id} req={req} onChange={(s, note) => onUpdate(list, req, s, note)} />
          ))}
        </List>
      )}
    </div>
  );
}

function RequirementRow({ req, onChange }: { req: ReferralRequirement; onChange: (s: RequirementStatus, note?: string) => Promise<void> }) {
  const Icon = KIND_ICONS[req.kind];
  const [note, setNote] = useState(req.note ?? '');
  const noteId = `note-${req.id}`;
  return (
    <ListRow
      title={req.label}
      leading={<Icon aria-hidden className="text-ink-2" />}
      meta={[REQUIREMENT_KIND_LABELS[req.kind], req.detail].filter(Boolean).join(' · ')}
    >
      <div className="grid gap-2">
        <SourceLink url={req.sourceUrl} />
        <div role="group" aria-label={`Status for ${req.label}`} className="flex flex-wrap gap-2">
          {REQUIREMENT_STATUS_ORDER.map(s => (
            <button
              key={s}
              type="button"
              aria-pressed={req.status === s}
              onClick={() => void onChange(s, note || undefined)}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-3.5 text-small font-semibold focus-ring transition-colors duration-150 motion-reduce:transition-none',
                req.status === s ? 'border-teal/40 bg-teal-soft text-teal-ink' : 'border-line-strong bg-card text-ink-2 hover:border-ink-3 hover:text-ink',
              )}
            >
              {req.status === s ? <Check aria-hidden className="size-4" /> : null}
              {REQUIREMENT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <Details label={null} summary={note ? 'Edit your note' : 'Add a note'} defaultOpen={Boolean(req.note)}>
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
        </Details>
      </div>
    </ListRow>
  );
}
