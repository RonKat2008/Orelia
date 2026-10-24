import { jsonError } from '@/app/api/cases/_lib/http';
import { VerificationError } from './service';

const MESSAGES: Record<string, string> = {
  resource_not_found: 'That resource is not on this case',
  case_not_found: 'Case not found',
  no_phone: 'No verified phone number was found for this resource, so it cannot be called',
  diagnosis_missing: 'The case has no diagnosis name to ask about',
  already_calling: 'A verification call to this resource is already in progress',
  verification_not_found: 'Verification request not found',
  already_approved: 'This verification call was already approved',
  gate_refused: 'This call cannot be placed',
  call_failed: 'The call could not be placed',
  call_state_changed: 'The call changed; reload and try again',
};

/** Error envelope like the plan route; gate refusals carry reason codes only, never provider text. */
export function verificationErrorResponse(err: unknown, fallback: string): Response {
  if (err instanceof VerificationError) {
    const message = MESSAGES[err.code] ?? fallback;
    if (err.reasons.length) return Response.json({ error: message, reasons: err.reasons }, { status: err.status });
    return jsonError(err.status, message);
  }
  return jsonError(500, fallback, err);
}
