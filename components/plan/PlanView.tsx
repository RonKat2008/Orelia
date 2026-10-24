'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { ArrowRight } from 'lucide-react';
import type { ContactPlan, PlanEdit } from '@/lib/plan/contract';
import { buildPlan, getOrBuildPlan, patchPlan, type PlanResult } from './client';
import { approveOutcome, type ApproveOutcome, movedIds, parseMaterialized, toggleEdit, withOrder, withToggle } from './model';
import { PlanBoard } from './PlanBoard';
import type { PlanEvidenceMeta } from '@/lib/plan/evidence-meta';

type Phase = 'loading' | 'ready' | 'error';

export function PlanView({ caseId }: { caseId: string }) {
  const [plan, setPlan] = useState<ContactPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ApproveOutcome | null>(null);
  const [editing, setEditing] = useState(false);
  const [evidence, setEvidence] = useState<PlanEvidenceMeta>({});
  const planRef = useRef<ContactPlan | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const apply = useCallback((res: PlanResult) => {
    if (res.ok) {
      setPlan(res.plan);
      if (res.evidence) setEvidence(res.evidence);
      setPhase('ready');
    } else {
      setError(res.message);
      setPhase('error');
    }
  }, []);

  const load = useCallback(async () => {
    apply(await getOrBuildPlan(caseId));
  }, [apply, caseId]);

  useEffect(() => {
    let active = true;
    void getOrBuildPlan(caseId).then(res => {
      if (active) apply(res);
    });
    return () => {
      active = false;
    };
  }, [apply, caseId]);

  const edit = useCallback(
    async (edits: PlanEdit[], optimistic: ContactPlan | null): Promise<PlanResult | null> => {
      const before = planRef.current;
      if (!before) return null;
      setBusy(true);
      if (optimistic) setPlan(optimistic);
      const res = await patchPlan(caseId, before.version, edits);
      setBusy(false);
      if (res.ok) {
        setPlan(res.plan);
        if (res.evidence) setEvidence(res.evidence);
        return res;
      }
      setPlan(before);
      if (res.status === 409) {
        toast.info('Plan changed, reloading');
        setPhase('loading');
        await load();
      } else {
        toast.error(res.message);
      }
      return res;
    },
    [caseId, load],
  );

  const onToggle = (resourceKey: string, stepId: string, enabled: boolean) => {
    const current = planRef.current;
    if (!current) return;
    void edit([toggleEdit(resourceKey, stepId, enabled)], withToggle(current, resourceKey, stepId, enabled));
  };

  const onMove = (resourceKey: string, stepId: string, delta: -1 | 1) => {
    const current = planRef.current;
    const resource = current?.resources.find(r => r.resourceKey === resourceKey);
    if (!current || !resource) return;
    const stepIds = movedIds(resource, stepId, delta);
    if (!stepIds) return;
    void edit([{ type: 'reorder', resourceKey, stepIds }], withOrder(current, resourceKey, stepIds));
  };

  const onApprove = async () => {
    const res = await edit([{ type: 'approve' }], null);
    if (res?.ok) {
      const result = approveOutcome(parseMaterialized(res.materialized));
      setOutcome(result);
      setEditing(false);
      if (result.count > 0) toast.success(result.headline);
      else toast.info(result.headline);
    }
  };

  const onRebuild = async () => {
    setBusy(true);
    const res = await buildPlan(caseId);
    setBusy(false);
    if (res.ok) {
      setPlan(res.plan);
      if (res.evidence) setEvidence(res.evidence);
      toast.success('Plan rebuilt');
    } else if (res.status === 409) {
      toast.info('Plan changed, reloading');
      setPhase('loading');
      await load();
    } else {
      toast.error(res.message);
    }
  };

  if (phase === 'loading') {
    return (
      <div className="ds-root flex flex-col gap-4" role="status" aria-busy="true">
        <p className="m-0 text-body text-ink-2">
          Getting your plan ready. If this is your first visit, we are building it from the resources you chose.
        </p>
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (phase === 'error' || !plan) {
    return (
      <div className="ds-root">
        <EmptyState
          title="We could not build a plan yet"
          description={error ?? 'Choose who to contact on the shortlist, then come back.'}
          action={<Button variant="secondary" onClick={() => {
            setPhase('loading');
            void load();
          }}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {outcome && plan.status === 'approved' ? (
        <section role="status" aria-labelledby="plan-outcome-heading" className="border-l-2 border-teal pl-4">
          <h3 id="plan-outcome-heading" className="m-0 text-h3 text-ink">{outcome.headline}</h3>
          <p className="m-0 mt-1 max-w-prose text-body text-ink-2">{outcome.detail}</p>
          <Button asChild variant="link" className="mt-2">
            <Link href={`/cases/${caseId}/outbox`}>
              Open the outbox <ArrowRight aria-hidden />
            </Link>
          </Button>
        </section>
      ) : null}
      <PlanBoard plan={plan} evidence={evidence} busy={busy} caseId={caseId} draftCount={outcome?.count ?? null} editing={editing} onEdit={() => setEditing(true)} onToggle={onToggle} onMove={onMove} onApprove={() => void onApprove()} onRebuild={() => void onRebuild()} />
    </div>
  );
}
