/**
 * AgentMail-backed DemoMail. API shapes verified against agentmail@0.5.46
 * (node_modules/agentmail/dist/esm). Differences from the task's assumptions:
 * - The client class is `AgentMailClient`; methods return HttpResponsePromise
 *   that resolves directly to the body (e.g. `await client.inboxes.create(...)`).
 * - Inbox address is the `email` field (not `address`); ids are `inboxId`.
 * - inboxes.create takes `{ username, displayName, clientId? }`. Passing a
 *   clientId makes create idempotent per AgentMail docs, but we dedupe via list.
 * - inboxes.list returns `{ inboxes, nextPageToken }` (paginated, newest first).
 * - messages.list returns MessageItem WITHOUT body text (only `preview`), newest
 *   first by default; we pass `ascending: true` and call messages.get per item to
 *   obtain `text`. Timestamps are Date objects (`timestamp`).
 * - messages.list ALSO returns messages we sent; we drop those whose `from`
 *   contains the inbox's own address.
 * - messages.reply(inboxId, messageId, { text }) returns `{ messageId, threadId }`.
 */
import { AgentMailClient } from "agentmail";
import type { DemoInbox, DemoMail, DemoMessage } from "./mail";
import { DryRunMail } from "./dry-run-mail";

/** Minimal structural type of the client surface we use (lets tests inject a mock). */
export interface AgentMailLike {
  inboxes: {
    create(req: { username?: string; displayName?: string }): PromiseLike<InboxLike>;
    list(req?: { limit?: number; pageToken?: string }): PromiseLike<{
      inboxes: InboxLike[];
      nextPageToken?: string;
    }>;
    delete(inboxId: string): PromiseLike<unknown>;
    messages: {
      list(
        inboxId: string,
        req?: { limit?: number; pageToken?: string; ascending?: boolean },
      ): PromiseLike<{ messages: MessageLike[]; nextPageToken?: string }>;
      get(inboxId: string, messageId: string): PromiseLike<MessageLike>;
      reply(
        inboxId: string,
        messageId: string,
        req: { text: string },
      ): PromiseLike<{ messageId: string; threadId?: string }>;
    };
  };
}

interface InboxLike {
  inboxId: string;
  email: string;
  displayName?: string;
}

interface MessageLike {
  inboxId: string;
  threadId: string;
  messageId: string;
  timestamp: Date | string;
  from: string;
  to: string[];
  subject?: string;
  preview?: string;
  text?: string;
}

function toInbox(i: InboxLike): DemoInbox {
  return { inboxId: i.inboxId, address: i.email, displayName: i.displayName ?? "" };
}

export class AgentMailDemoMail implements DemoMail {
  readonly mode = "agentmail" as const;
  private readonly client: AgentMailLike;

  constructor(opts: { apiKey?: string; client?: AgentMailLike }) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      if (!opts.apiKey) throw new Error("AgentMailDemoMail requires an apiKey or client");
      this.client = new AgentMailClient({ apiKey: opts.apiKey }) as unknown as AgentMailLike;
    }
  }

  async createInbox(input: { username: string; displayName: string }): Promise<DemoInbox> {
    const inbox = await this.client.inboxes.create({
      username: input.username,
      displayName: input.displayName,
    });
    return toInbox(inbox);
  }

  async listInboxes(): Promise<DemoInbox[]> {
    const out: DemoInbox[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.client.inboxes.list({ limit: 100, pageToken });
      out.push(...page.inboxes.map(toInbox));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async deleteInbox(inboxId: string): Promise<void> {
    await this.client.inboxes.delete(inboxId);
  }

  async listReceived(inboxId: string): Promise<DemoMessage[]> {
    const self = (await this.listInboxes()).find((i) => i.inboxId === inboxId)?.address ?? inboxId;
    const items: MessageLike[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.client.inboxes.messages.list(inboxId, {
        limit: 100,
        pageToken,
        ascending: true,
      });
      items.push(...page.messages);
      pageToken = page.nextPageToken;
    } while (pageToken);

    const received = items.filter((m) => !m.from.toLowerCase().includes(self.toLowerCase()));
    const full = await Promise.all(
      received.map(async (m) => (m.text !== undefined ? m : this.client.inboxes.messages.get(inboxId, m.messageId))),
    );
    return full.map((m) => ({
      messageId: m.messageId,
      threadId: m.threadId,
      inboxId: m.inboxId,
      from: m.from,
      to: m.to,
      subject: m.subject ?? "",
      text: m.text ?? m.preview ?? "",
      receivedAt: new Date(m.timestamp).toISOString(),
    }));
  }

  async reply(inboxId: string, messageId: string, text: string): Promise<{ messageId: string }> {
    const res = await this.client.inboxes.messages.reply(inboxId, messageId, { text });
    return { messageId: res.messageId };
  }
}

export function createDemoMail(opts: {
  dryRun?: boolean;
  env?: Record<string, string | undefined>;
}): DemoMail {
  const env = opts.env ?? process.env;
  const apiKey = env.AGENTMAIL_API_KEY;
  if (opts.dryRun || !apiKey) return new DryRunMail();
  return new AgentMailDemoMail({ apiKey });
}
