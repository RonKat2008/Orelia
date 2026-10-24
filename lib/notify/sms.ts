/** SMS is an interface only. No provider is wired. */
export interface SmsNotifier {
  send(input: { to: string; text: string }): Promise<{ id: string }>;
}

export class SmsNotConfigured implements SmsNotifier {
  async send(): Promise<{ id: string }> {
    throw new Error('SMS notifications are not configured');
  }
}
