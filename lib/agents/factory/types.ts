/**
 * ResourceAgent: one persistent, self-managing agent per selected resource. It owns its channels (its own email
 * inbox or a per-agent thread in the case inbox, its calls, its web applications), its memory and its event log.
 * Code decides which actions are allowed; the model only chooses among them. Every outbound action is a DRAFT that
 * waits for the patient's approval and the unchanged outbound gate.
 */
import { z } from 'zod';

export const AGENT_GOALS = ['appointment', 'trial_screening', 'membership', 'aid_application'] as const;
export type AgentGoal = typeof AGENT_GOALS[number];

export const AGENT_CHANNELS = ['email', 'call', 'web'] as const;
export type AgentChannel = typeof AGENT_CHANNELS[number];

export const AGENT_STATES = ['planning', 'awaiting_approval', 'waiting_reply', 'working', 'escalated', 'done', 'failed'] as const;
export type AgentState = typeof AGENT_STATES[number];

export const AGENT_ACTIONS = [
  'draft_email', 'draft_call', 'fill_web', 'follow_up', 'answer_request', 'switch_channel', 'escalate', 'finish', 'wait',
] as const;
export type AgentAction = typeof AGENT_ACTIONS[number];

export const INBOX_MODES = ['pending', 'own', 'shared', 'demo', 'none'] as const;
export type InboxMode = typeof INBOX_MODES[number];

export type AgentTrigger = 'spawn' | 'cron' | 'webhook:email' | 'webhook:voice' | 'webhook:kernel' | 'manual' | 'approval';

/** What the agent knows so far. Strictly its own: built only from its own contact's threads, calls and applications. */
export interface AgentMemory {
  summary: string;
  spokeWith: string[];
  requests: { taskId: string; kind: string; title: string }[];
  answered: string[];
  remaining: string[];
  replies: number;
  calls: number;
  applications: number;
  lastInboundAt: string | null;
  /** ISO time the current channel's first outbound went out (switch deadline counts from here). */
  channelStartedAt: string | null;
  /** Ids of actions already taken on this channel step so a repeated wake never re-drafts. */
  done: string[];
  /** The resource's phone (for matching inbound calls to the shared number), when known. */
  resourcePhone: string | null;
  /** Facts the patient told this agent in chat (new phone, availability...). Patient-provided, never shared unasked. */
  notes: { key: string; value: string; at: string }[];
  /** Patient constraints. channels: the only channels this agent may use (e.g. "email only"). */
  constraints: { channels?: AgentChannel[] };
}

export function emptyMemory(): AgentMemory {
  return { summary: '', spokeWith: [], requests: [], answered: [], remaining: [], replies: 0, calls: 0, applications: 0, lastInboundAt: null, channelStartedAt: null, done: [], resourcePhone: null, notes: [], constraints: {} };
}

export interface ResourceAgent {
  id: string;
  caseId: string;
  contactId: string | null;
  resourceKey: string;
  name: string;
  goal: AgentGoal;
  strategy: AgentChannel[];
  strategyStep: number;
  state: AgentState;
  nextAction: string | null;
  nextActionAt: string | null;
  memory: AgentMemory;
  inboxMode: InboxMode;
  inboxId: string | null;
  inboxAddress: string | null;
  createdAt: string;
  lastRunAt: string | null;
}

export interface AgentEvent {
  id: string;
  agentId: string;
  caseId: string;
  kind: 'spawned' | 'wake' | 'decision' | 'action' | 'blocked' | 'error';
  trigger: AgentTrigger | null;
  reason: string | null;
  action: AgentAction | null;
  result: string | null;
  data?: Record<string, unknown> | null;
  createdAt: string;
}

/** The model's output. Validated, then re-checked against the code-computed allowed set. */
export const agentDecisionSchema = z.object({
  action: z.enum(AGENT_ACTIONS),
  reason: z.string().min(1).max(280),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
