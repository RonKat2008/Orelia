import type { NotifyMailer } from './service';

export interface SystemInboxClient {
  inboxes: {
    messages: {
      send(
        inboxId: string,
        body: { to: string; subject: string; text: string; labels?: string[] },
        opts?: { maxRetries: number },
      ): Promise<{ messageId: string }>;
    };
  };
}

/** Sends from the Wayfinder system inbox to the patient's own address. */
export function agentMailNotifier(client: SystemInboxClient, inboxId: string): NotifyMailer {
  return {
    async send(input) {
      const res = await client.inboxes.messages.send(
        inboxId,
        { to: input.to, subject: input.subject, text: input.text, labels: ['wayfinder', 'patient-notify'] },
        { maxRetries: 0 },
      );
      return { id: res.messageId };
    },
  };
}
