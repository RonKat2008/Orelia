'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, FileText, Mail, Phone, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import {
  Badge,
  Button,
  IconButton,
  JudgeOnly,
  List,
  ListRow,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from '@/components/ui';
import type { ContactPlan, PlanChannel, PlanStep, ResourcePlan } from '@/lib/plan/contract';
import type { PlanEvidenceMeta } from '@/lib/plan/evidence-meta';
import { DemoLabelBadge, useDemoDestinations } from '@/components/outreach/DemoCoordinators';
import {
  KIND_LABELS,
  enabledStepCount,
  demoStepLabel,
  evidenceBadgeText,
  isHttpUrl,
  isRegistryPlan,
  stepLabel,
  sortedSteps,
  waitText,
} from './model';
import { CASE_SECTION_HEADING } from "@/components/outreach/CasePage";

const SectionH = CASE_SECTION_HEADING;

const CHANNEL_ICONS: Record<PlanChannel, LucideIcon> = { voice: Phone, email: Mail, web_form: FileText };

/** At most this many badges per row; further sources are plain small text. */
const MAX_ROW_BADGES = 2;

export interface PlanBoardProps {
  plan: ContactPlan;
  /** Source host/kind per cited evidence id (from the plan API); ids without metadata fall back to a short id. */
  evidence?: PlanEvidenceMeta;
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

export function PlanBoard({ plan, evidence = {}, busy = false, onToggle, onMove, onApprove, onRebuild, caseId, draftCount, editing = false, onEdit }: PlanBoardProps) {
  const enabled = enabledStepCount(plan);
  const showApproved = plan.status === 'approved' && !editing;
  return (
    <div className="ds-root flex min-w-0 flex-col gap-6">
      <p className="m-0 max-w-prose text-body text-ink-2 text-pretty" data-testid="plan-summary">
        {plan.summary}
      </p>
      <ul className="m-0 flex list-none flex-col gap-8 p-0">
        {plan.resources.map(resource => (
          <li key={resource.resourceKey} className="min-w-0">
            <ResourceSection resource={resource} evidence={evidence} busy={busy} onToggle={onToggle} onMove={onMove} />
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button size="lg" disabled={busy || enabled === 0} onClick={onApprove}>
              Approve plan &amp; draft messages
            </Button>
            <MoreMenu busy={busy} onRebuild={onRebuild} />
          </div>
          <p className="m-0 text-small text-ink-2">Nothing is sent without your OK. You read every message first.</p>
        </div>
      )}
      {enabled === 0 && !showApproved ? (
        <p className="m-0 text-small text-warn-ink" role="status">
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

function MoreMenu({ busy, onRebuild }: { busy: boolean; onRebuild: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link">More</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-40 p-1">
        <PopoverClose asChild>
          <Button variant="link" disabled={busy} onClick={onRebuild}>
            Rebuild plan
          </Button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

function ResourceSection({
  resource,
  evidence,
  busy,
  onToggle,
  onMove,
}: {
  resource: ResourcePlan;
  evidence: PlanEvidenceMeta;
  busy: boolean;
  onToggle: PlanBoardProps['onToggle'];
  onMove: PlanBoardProps['onMove'];
}) {
  const steps = sortedSteps(resource);
  const headingId = `plan-resource-${resource.resourceKey.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0">
      <SectionH id={headingId} className="m-0 text-h3 text-ink break-words">
        {resource.name}
      </SectionH>
      <p className="m-0 mt-1 text-small text-ink-2">{KIND_LABELS[resource.targetKind] ?? resource.targetKind}</p>
      {resource.unavailableReason || steps.length === 0 ? (
        <p className="m-0 mt-3 text-body text-ink-2" data-testid="plan-unavailable">
          {resource.unavailableReason ?? 'No way to reach this resource was found.'}
        </p>
      ) : (
        <List className="mt-3">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              evidence={evidence}
              index={index}
              total={steps.length}
              resourceName={resource.name}
              registry={isRegistryPlan(resource)}
              busy={busy}
              onToggle={enabled => onToggle(resource.resourceKey, step.id, enabled)}
              onMove={delta => onMove(resource.resourceKey, step.id, delta)}
            />
          ))}
        </List>
      )}
    </div>
  );
}

function StepRow({
  step,
  evidence,
  index,
  total,
  resourceName,
  registry,
  busy,
  onToggle,
  onMove,
}: {
  step: PlanStep;
  evidence: PlanEvidenceMeta;
  index: number;
  total: number;
  resourceName: string;
  registry: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const demo = useDemoDestinations();
  const demoLabel = demo.enabled ? demoStepLabel(step.channel, demo.callsRingTestNumber) : null;
  const Icon = CHANNEL_ICONS[step.channel];
  const label = stepLabel(step, { registry });
  const isLast = index === total - 1;
  const wait = index === 0 && step.waitFor === 'none' ? null : waitText(step.waitFor, index === 0);

  // Badge budget: Skipped and the test-inbox label come first, then sources; anything beyond the cap is plain text.
  const pool: ReactNode[] = [];
  if (!step.enabled) {
    pool.push(
      <Badge key="skipped" tone="outline" size="sm">
        Skipped
      </Badge>,
    );
  }
  if (demoLabel) pool.push(<DemoLabelBadge key="demo" label={demoLabel} />);
  const sourceIds = step.evidenceIds;
  // One source badge at most, and none beside a status badge: two nowrap badges overflow a 320 px row.
  const sourceSlots = pool.length > 0 ? 0 : 1;
  sourceIds.slice(0, sourceSlots).forEach(id => {
    pool.push(
      <JudgeOnly key={id}>
        <Badge tone="outline" size="sm" title={evidence[id]?.host ? `Source: ${evidence[id]!.host}` : id}>
          {evidenceBadgeText(id, evidence[id])}
        </Badge>
      </JudgeOnly>,
    );
  });
  const extraSources = sourceIds.slice(sourceSlots).map(id => evidenceBadgeText(id, evidence[id]));

  return (
    <ListRow
      data-testid="plan-step"
      title={label}
      maxBadges={MAX_ROW_BADGES}
      badges={pool}
      leading={
        <span className="flex flex-col items-center gap-1 text-ink-2">
          <Icon aria-hidden className="size-4" />
          {isLast ? null : <span aria-hidden data-testid="plan-connector" className="h-3 w-px bg-line-strong" />}
        </span>
      }
      meta={
        <>
          {wait ? <span>{wait} · </span> : null}
          <span className="text-pretty">{step.reason}</span>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {extraSources.length > 0 ? (
          <JudgeOnly>
            <span className="text-small text-ink-2">Also from {extraSources.join(', ')}</span>
          </JudgeOnly>
        ) : null}
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
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 items-center gap-2 text-small font-semibold text-ink">
          <Switch checked={step.enabled} disabled={busy} onCheckedChange={onToggle} />
          <span>
            Include<span className="sr-only"> step {index + 1}: {label} for {resourceName}</span>
          </span>
        </label>
        {total >= 2 ? (
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
        ) : null}
      </div>
    </ListRow>
  );
}
