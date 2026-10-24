/**
 * Mail access for the demo scripts. Two implementations:
 * - DryRunMail (scripts/demo/dry-run-mail.ts): in-memory/file-backed, no network.
 *   Used whenever AGENTMAIL_API_KEY is absent or --dry-run is passed.
 * - AgentMailDemoMail (scripts/demo/agentmail-mail.ts): real AgentMail test inboxes.
 *
 * These are only for the FICTIONAL coordinator inboxes we create. Patient-side
 * outreach never uses this module; it goes through lib/safety checkOutbound.
 */
export interface DemoInbox {
  inboxId: string;
  address: string;
  displayName: string;
  /** An existing inbox we only borrowed (demo coordinator mode). demo-reset never deletes it. */
  borrowed?: boolean;
}

export interface DemoMessage {
  messageId: string;
  threadId: string;
  inboxId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  receivedAt: string; // ISO
}

export interface DemoMail {
  readonly mode: 'dry-run' | 'agentmail';
  createInbox(input: { username: string; displayName: string }): Promise<DemoInbox>;
  listInboxes(): Promise<DemoInbox[]>;
  deleteInbox(inboxId: string): Promise<void>;
  /** Messages received by an inbox, oldest first. */
  listReceived(inboxId: string): Promise<DemoMessage[]>;
  /** Reply in-thread to a received message. Callers must check the allowlist first. */
  reply(inboxId: string, messageId: string, text: string): Promise<{ messageId: string }>;
}

export interface CoordinatorSpec {
  key: string;
  username: string;
  displayName: string;
  scenario: 'please_send_slides' | 'needs_referral' | 'call_to_schedule' | 'silent';
  delaySeconds: number | null;
  reply: string | null;
}
