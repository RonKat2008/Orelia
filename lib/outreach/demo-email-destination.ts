/**
 * Demo email destination choice (WAYFINDER_DEMO_COORDINATORS=1). DEMO ONLY.
 *
 * A presenter picks, per case, where TEST emails go:
 *   - 'scripted': the configured coordinator inboxes ending in @agentmail.to (the scripted coordinator auto-replies there).
 *   - 'personal': the configured coordinator inboxes NOT ending in @agentmail.to (the presenter's own inbox).
 * Only addresses already in demoCoordinatorInboxes(env) (DEMO_COORDINATOR_INBOXES, and also on OUTBOUND_ALLOWLIST) can
 * ever be chosen: the choice is one of two words, never an address, and never comes from free text. checkOutbound
 * still runs on every send, so a chosen address that is not allowlisted is refused exactly as before.
 */
import { normalizeAddress } from '../safety/allowlist';
import { demoCoordinatorFor, demoCoordinatorInboxes } from './demo-coordinators';

type Env = Record<string, string | undefined>;

export type EmailDestinationChoice = 'scripted' | 'personal';
export const EMAIL_DESTINATION_CHOICES: readonly EmailDestinationChoice[] = ['scripted', 'personal'];
export const DEFAULT_EMAIL_DESTINATION: EmailDestinationChoice = 'scripted';

export const isEmailDestinationChoice = (v: unknown): v is EmailDestinationChoice => v === 'scripted' || v === 'personal';

/** The scripted test coordinator lives on AgentMail; everything else is the presenter's own inbox. */
export const isScriptedInbox = (address: string | null | undefined): boolean => {
  const a = address ? normalizeAddress(address) : null;
  return !!a && a.endsWith('@agentmail.to');
};

export interface EmailDestinationGroups { scripted: string[]; personal: string[] }

export function emailDestinationGroups(env: Env): EmailDestinationGroups {
  const all = demoCoordinatorInboxes(env);
  return { scripted: all.filter(isScriptedInbox), personal: all.filter(a => !isScriptedInbox(a)) };
}

/** What the UI may know: which options exist. Never the addresses. */
export interface EmailDestinationAvailability { scripted: boolean; personal: boolean }
export function emailDestinationAvailability(env: Env): EmailDestinationAvailability {
  const g = emailDestinationGroups(env);
  return { scripted: g.scripted.length > 0, personal: g.personal.length > 0 };
}

/**
 * The inboxes a contact may be routed to. An explicit choice uses only its group (empty when the group is empty).
 * No stored choice means the default: scripted, falling back to every configured inbox when there is no scripted one.
 */
export function emailInboxesFor(env: Env, choice: EmailDestinationChoice | undefined): string[] {
  const g = emailDestinationGroups(env);
  if (choice) return g[choice];
  return g[DEFAULT_EMAIL_DESTINATION].length > 0 ? g[DEFAULT_EMAIL_DESTINATION] : demoCoordinatorInboxes(env);
}

/** The demo inbox for a resource under this choice, or undefined when that group is empty. */
export function demoEmailAddressFor(env: Env, choice: EmailDestinationChoice | undefined, targetKey: string): string | undefined {
  return demoCoordinatorFor(targetKey, emailInboxesFor(env, choice));
}

/** Parses a stored value; anything unknown is "no choice". */
export const parseEmailChoice = (raw: string | null | undefined): EmailDestinationChoice | undefined => (isEmailDestinationChoice(raw) ? raw : undefined);

/** Which group a (demo-routed) address belongs to, for labels. */
export const choiceOfAddress = (address: string | null | undefined): EmailDestinationChoice => (isScriptedInbox(address) ? 'scripted' : 'personal');
