import fs from "node:fs";
import path from "node:path";
import type { DemoInbox, DemoMail, DemoMessage } from "./mail";
import { stateDir } from "./state";

/**
 * File-backed fake mailbox. No network. Addresses use the reserved .invalid TLD
 * so they can never route anywhere real.
 */
export const DRY_RUN_DOMAIN = "dry-run.agentmail.invalid";

interface Store {
  seq: number;
  inboxes: DemoInbox[];
  received: DemoMessage[]; // messages delivered to an inbox (inboxId = recipient)
  sent: DemoMessage[]; // replies made (inboxId = sender)
}

export function dryRunMailPath(): string {
  return path.join(stateDir(), "dry-run-mail.json");
}

export function clearDryRunMail(): void {
  fs.rmSync(dryRunMailPath(), { force: true });
}

function emptyStore(): Store {
  return { seq: 0, inboxes: [], received: [], sent: [] };
}

export class DryRunMail implements DemoMail {
  readonly mode = "dry-run" as const;

  private read(): Store {
    try {
      return { ...emptyStore(), ...(JSON.parse(fs.readFileSync(dryRunMailPath(), "utf8")) as Store) };
    } catch {
      return emptyStore();
    }
  }

  private write(store: Store): void {
    const p = dryRunMailPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2));
  }

  async createInbox(input: { username: string; displayName: string }): Promise<DemoInbox> {
    const store = this.read();
    const address = `${input.username}@${DRY_RUN_DOMAIN}`;
    const existing = store.inboxes.find((i) => i.address === address);
    if (existing) return existing;
    const inbox: DemoInbox = { inboxId: address, address, displayName: input.displayName };
    store.inboxes.push(inbox);
    this.write(store);
    return inbox;
  }

  async listInboxes(): Promise<DemoInbox[]> {
    return this.read().inboxes;
  }

  async deleteInbox(inboxId: string): Promise<void> {
    const store = this.read();
    store.inboxes = store.inboxes.filter((i) => i.inboxId !== inboxId);
    store.received = store.received.filter((m) => m.inboxId !== inboxId);
    this.write(store);
  }

  async listReceived(inboxId: string): Promise<DemoMessage[]> {
    return this.read().received.filter((m) => m.inboxId === inboxId);
  }

  async reply(inboxId: string, messageId: string, text: string): Promise<{ messageId: string }> {
    const store = this.read();
    const inbox = store.inboxes.find((i) => i.inboxId === inboxId);
    const original = store.received.find((m) => m.inboxId === inboxId && m.messageId === messageId);
    if (!inbox || !original) throw new Error(`dry-run: unknown inbox/message ${inboxId} ${messageId}`);
    const id = `dry-msg-${++store.seq}`;
    store.sent.push({
      messageId: id,
      threadId: original.threadId,
      inboxId,
      from: inbox.address,
      to: [original.from],
      subject: original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`,
      text,
      receivedAt: new Date().toISOString(),
    });
    this.write(store);
    return { messageId: id };
  }

  /** Simulate an inbound email to one of our inboxes (tests / dry-run demo). */
  async deliver(
    toAddress: string,
    msg: { from: string; subject: string; text: string; threadId?: string },
  ): Promise<DemoMessage> {
    const store = this.read();
    const inbox = store.inboxes.find((i) => i.address === toAddress);
    if (!inbox) throw new Error(`dry-run: no inbox ${toAddress}`);
    const n = ++store.seq;
    const message: DemoMessage = {
      messageId: `dry-msg-${n}`,
      threadId: msg.threadId ?? `dry-thread-${n}`,
      inboxId: inbox.inboxId,
      from: msg.from,
      to: [toAddress],
      subject: msg.subject,
      text: msg.text,
      receivedAt: new Date().toISOString(),
    };
    store.received.push(message);
    this.write(store);
    return message;
  }

  /** Replies made through reply(), oldest first. */
  sent(): DemoMessage[] {
    return this.read().sent;
  }
}
