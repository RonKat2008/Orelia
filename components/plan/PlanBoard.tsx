'use client';

import { ArrowDown, ArrowUp, Globe, Mail, Phone, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Badge, Button, Card, CardEyebrow, CardTitle, IconButton, Switch } from '@/components/ui';
import { useReducedMotionGate } from '@/lib/motion/MotionPreference';
import { DURATION, EASE, STAGGER } from '@/lib/motion/tokens';
import type { ContactPlan, PlanChannel, PlanStep, ResourcePlan } from '@/lib/plan/contract';
import {
  CHANNEL_LABELS,
  KIND_LABELS,
  PURPOSE_LABELS,
  enabledStepCount,
  isHttpUrl,
  shortEvidenceId,
  sortedSteps,
  waitText,
} from './model';

const CHANNEL_ICONS: Record<PlanChannel, LucideIcon> = { voice: Phone, email: Mail, web_form: Globe };

export interface PlanBoardProps {
  plan: ContactPlan;
  busy?: boolean;
  onToggle: (resourceKey: string, stepId: string, enabled: boolean) => void;
  onMove: (resourceKey: string, stepId: string, delta: -1 | 1) => void;
  onApprove: () => void;
  onRebuild: () => void;
  /** Needed to link to the outbox once the plan is approved. */
  caseId?: string;
  /** Drafts written when approved; null/undefined when not known (e.g. after a reload). */
  draftCount?: number | null;
  /** True after the user chose Edit plan; shows the approve controls again. */
  editing?: boolean;
  onEdit?: () => void;
}

export function PlanBoard({ plan, busy = false, onToggle, onMove, onApprove, onRebuild, caseId, draftCount, editing = false, onEdit }: PlanBoardProps) {
  const enabled = enabledStepCount(plan);
  const showApproved = plan.status === 'approved' && !editing;
  return (
    <div className="ds-root flex flex-col gap-stack">
      <p className="max-w-prose text-lead text-ink-2 text-pretty" data-testid="plan-summary">
        {plan.summary}
      </p>
      <p className="text-small text-ink-3">
        Nothing is sent from this page. You review every message before it goes out.
      </p>
      <ul className="m-0 flex list-none flex-col gap-6 p-0">
        {plan.resources.map(resource => (
          <li key={resource.resourceKey}>
            <ResourceCard resource={resource} busy={busy} onToggle={onToggle} onMove={onMove} />
          </li>
        ))}
      </ul>
      {showApproved ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center" data-testid="plan-approved">
          <p className="m-0 text-body font-semibold text-teal-ink" role="status">
            {approvedText(draftCount)}
          </p>
          {caseId ? (
            <Button asChild size="lg">
              <Link href={`/cases/${caseId}/outbox`}>Open the outbox</Link>
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" disabled={busy} onClick={onEdit}>
            Edit plan
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button size="lg" disabled={busy || enabled === 0} onClick={onApprove}>
            Approve plan &amp; draft messages
          </Button>
          <Button variant="secondary" size="lg" disabled={busy} onClick={onRebuild}>
            Rebuild plan
          </Button>
        </div>
      )}
      {enabled === 0 && !showApproved ? (
        <p className="text-small text-warn-ink" role="status">
          Turn on at least one step to continue.
        </p>
      ) : null}
    </div>
  );
}

/** Status line for an approved plan. */
export function approvedText(draftCount: number | null | undefined): string {
  if (draftCount == null) return 'Plan approved · drafts are in the outbox';
  return `Plan approved · ${draftCount} ${draftCount === 1 ? 'draft' : 'drafts'} in the outbox`;
}

function ResourceCard({
  resource,
  busy,
  onToggle,
  onMove,
}: {
  resource: ResourcePlan;
  busy: boolean;
  onToggle: PlanBoardProps['onToggle'];
  onMove: PlanBoardProps['onMove'];
}) {
  const steps = sortedSteps(resource);
  const headingId = `plan-resource-${resource.resourceKey.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return (
    <Card variant="raised" padding="md" aria-labelledby={headingId} role="group" className="min-w-0">
      <CardEyebrow>{KIND_LABELS[resource.targetKind] ?? resource.targetKind}</CardEyebrow>
      <CardTitle id={headingId} className="display-soft font-display text-h3 break-words">
        {resource.name}
      </CardTitle>
      {resource.unavailableReason || steps.length === 0 ? (
        <p className="mt-3 text-body text-ink-2" data-testid="plan-unavailable">
          {resource.unavailableReason ?? 'No way to reach this resource was found.'}
        </p>
      ) : (
        <ol className="m-0 mt-4 flex list-none flex-col p-0">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              total={steps.length}
              resourceName={resource.name}
              busy={busy}
              onToggle={enabled => onToggle(resource.resourceKey, step.id, enabled)}
              onMove={delta => onMove(resource.resourceKey, step.id, delta)}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}

function StepRow({
  step,
  index,
  total,
  resourceName,
  busy,
  onToggle,
  onMove,
}: {
  step: PlanStep;
  index: number;
  total: number;
  resourceName: string;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const reduced = useReducedMotionGate();
  const Icon = CHANNEL_ICONS[step.channel];
  const label = `${PURPOSE_LABELS[step.purpose]} by ${CHANNEL_LABELS[step.channel].toLowerCase()}`;
  const isLast = index === total - 1;
  const connector = reduced
    ? { initial: false as const }
    : {
        initial: { scaleY: 0, opacity: 0 },
        animate: { scaleY: 1, opacity: 1 },
        transition: { duration: DURATION.slow, ease: EASE.arrive, delay: index * STAGGER.list * 2 },
      };
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" data-testid="plan-step">
      <div className="flex w-10 shrink-0 flex-col items-center">
        <span
          className={`flex size-10 items-center justify-center rounded-pill border ${
            step.enabled ? 'border-teal bg-teal-soft text-teal' : 'border-line-strong bg-paper-2 text-ink-3'
          }`}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        {isLast ? null : (
          <motion.span
            aria-hidden
            data-testid="plan-connector"
            style={{ originY: 0 }}
            className="mt-1 w-0.5 flex-1 rounded-pill bg-line-strong"
            {...connector}
          />
        )}
      </div>
      <div className={`min-w-0 flex-1 ${step.enabled ? '' : 'opacity-70'}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="m-0 text-h4 font-bold text-ink">{label}</p>
          <Badge tone="neutral" size="sm">
            {waitText(step.waitFor, index === 0)}
          </Badge>
          {step.enabled ? null : (
            <Badge tone="outline" size="sm">
              Skipped
            </Badge>
          )}
        </div>
        <p className="m-0 mt-1 text-body text-ink-2 text-pretty">{step.reason}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {step.evidenceIds.map(id => (
            <Badge key={id} tone="outline" size="sm" title={id}>
              {shortEvidenceId(id)}
            </Badge>
          ))}
          {step.channel === 'web_form' && isHttpUrl(step.targetRef) ? (
            <a
              href={step.targetRef}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring rounded-sm text-small text-teal underline underline-offset-4"
            >
              Open the form<span className="sr-only"> for {resourceName} (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 text-small font-semibold text-ink">
            <Switch
              checked={step.enabled}
              disabled={busy}
              onCheckedChange={onToggle}
              aria-label={`Include step ${index + 1}: ${label} for ${resourceName}`}
            />
            <span aria-hidden>{step.enabled ? 'Included' : 'Skipped'}</span>
          </label>
          <div className="flex items-center gap-1">
            <IconButton
              label={`Move step ${index + 1} earlier for ${resourceName}`}
              size="sm"
              disabled={busy || index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </IconButton>
            <IconButton
              label={`Move step ${index + 1} later for ${resourceName}`}
              size="sm"
              disabled={busy || isLast}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden />
            </IconButton>
          </div>
        </div>
      </div>
    </li>
  );
}
