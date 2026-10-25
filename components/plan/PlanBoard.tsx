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
import { cn } from '@/lib/ui/cn';
import { ClampText } from './ClampText';

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
    <div className="ds-root @container flex min-w-0 flex-col gap-4">
      <p className="m-0 max-w-prose text-body text-ink-2 text-pretty" data-testid="plan-summary">
        {plan.summary}
      </p>
      {/* Two resources side by side only when each column keeps a comfortable ~30rem; otherwise one column. */}
      <ul className="m-0 grid list-none gap-x-8 gap-y-6 p-0 @min-[62rem]:grid-cols-2 @min-[62rem]:items-start">
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
        <div
          data-slot="action-bar"
          className="sticky bottom-0 z-30 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-paper/95 px-1 py-2.5 backdrop-blur-md"
        >
          <p className="m-0 text-small text-ink-2">Nothing is sent without your OK. You read every message first.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <MoreMenu busy={busy} onRebuild={onRebuild} />
            <Button disabled={busy || enabled === 0} onClick={onApprove}>
              Approve plan &amp; draft messages
            </Button>
          </div>
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
      <SectionH id={headingId} className="m-0 font-sans text-body font-semibold text-ink break-words">
        {resource.name}
      </SectionH>
      <p className="m-0 text-small text-ink-2">{KIND_LABELS[resource.targetKind] ?? resource.targetKind}</p>
      {resource.unavailableReason || steps.length === 0 ? (
        <p className="m-0 mt-3 text-body text-ink-2" data-testid="plan-unavailable">
          {resource.unavailableReason ?? 'No way to reach this resource was found.'}
        </p>
      ) : (
        <List className="mt-1.5">
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

  // Status badges only (Skipped, the test-destination label); sources are calm secondary text below.
  const badges: ReactNode[] = [];
  if (!step.enabled) {
    badges.push(
      <Badge key="skipped" tone="outline" size="sm">
        Skipped
      </Badge>,
    );
  }
  if (demoLabel) badges.push(<DemoLabelBadge key="demo" label={demoLabel} />);
  const sources = step.evidenceIds.map(id => evidenceBadgeText(id, evidence[id]));
  const formLink = step.channel === 'web_form' && isHttpUrl(step.targetRef);

  return (
    <li
      data-slot="list-row"
      data-testid="plan-step"
      data-enabled={step.enabled}
      className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 border-b border-line py-3"
    >
      <span className="flex flex-col items-center gap-1 pt-1 text-ink-2">
        <Icon aria-hidden className="size-4 shrink-0" />
        {isLast ? null : <span aria-hidden data-testid="plan-connector" className="w-px flex-1 bg-line-strong" />}
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-[1_1_12rem] flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className={cn('min-w-0 text-body font-semibold leading-snug', step.enabled ? 'text-ink' : 'text-ink-2')}>{label}</span>
            {badges.length > 0 ? (
              <span data-slot="list-row-badges" className="flex shrink-0 items-center gap-1.5">
                {badges.slice(0, MAX_ROW_BADGES)}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <label className="flex min-h-10 items-center gap-1.5 pr-0.5 text-small font-semibold text-ink">
              <Switch checked={step.enabled} disabled={busy} onCheckedChange={onToggle} />
              <span>
                Include<span className="sr-only"> step {index + 1}: {label} for {resourceName}</span>
              </span>
            </label>
            {total >= 2 ? (
              <div className="flex items-center">
                <IconButton
                  label={`Move step ${index + 1} earlier for ${resourceName}`}
                  size="sm"
                  className="size-8"
                  disabled={busy || index === 0}
                  onClick={() => onMove(-1)}
                >
                  <ArrowUp aria-hidden />
                </IconButton>
                <IconButton
                  label={`Move step ${index + 1} later for ${resourceName}`}
                  size="sm"
                  className="size-8"
                  disabled={busy || isLast}
                  onClick={() => onMove(1)}
                >
                  <ArrowDown aria-hidden />
                </IconButton>
              </div>
            ) : null}
          </div>
        </div>
        <ClampText>
          {wait ? <span className="font-semibold text-ink">{wait} · </span> : null}
          {step.reason}
        </ClampText>
        {sources.length > 0 || formLink ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-3">
            {sources.length > 0 ? (
              <JudgeOnly>
                <span className="min-w-0 [overflow-wrap:anywhere]">{sources.join(' · ')}</span>
              </JudgeOnly>
            ) : null}
            {formLink ? (
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
        ) : null}
      </div>
    </li>
  );
}
