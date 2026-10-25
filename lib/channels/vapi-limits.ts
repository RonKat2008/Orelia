/**
 * Client-safe Vapi start-error helpers (no node imports): used by the adapter, the approve-all list and the console.
 */

/** Vapi endedReason values for calls that never started (nothing was dialed). */
export function isVapiStartError(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.startsWith('call.start.error');
}

/** True when Vapi refused the call because its free number hit the daily outbound limit (code or message). */
export function isVapiDailyLimit(text: string | null | undefined): boolean {
  return typeof text === 'string' && /outbound-daily-limit|daily outbound (call )?limit/i.test(text);
}

/** What the presenter sees when the phone line cannot place the call. */
export const PHONE_LINE_UNAVAILABLE = 'Phone line unavailable — take the call in your browser';
export const PHONE_LINE_DAILY_LIMIT_REASON = "Vapi's free phone number reached its daily outbound call limit, so nothing was dialed.";
