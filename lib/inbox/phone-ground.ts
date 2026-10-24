import { isPhoneGrounded } from '../safety/phone-grounding';
import type { InboxClassification } from './schema';

/**
 * Drops any phone number that is not one phone-shaped token in the inbound message. A redirect left with no
 * contact at all becomes unclear rather than a task that shows a guess.
 */
export function groundPhones(c: InboxClassification, body: string): InboxClassification {
  const out: InboxClassification = { ...c };
  if (out.phone !== undefined && !isPhoneGrounded(out.phone, body)) delete out.phone;
  if (out.redirect) {
    const redirect = { ...out.redirect };
    if (redirect.phone !== undefined && !isPhoneGrounded(redirect.phone, body)) delete redirect.phone;
    if (Object.values(redirect).some(Boolean)) out.redirect = redirect;
    else {
      delete out.redirect;
      return { class: 'unclear', confidence: Math.min(c.confidence, 0.4), rationale: 'Asked to contact someone else, but no contact was stated in the message.', ...(c.quote ? { quote: c.quote } : {}) };
    }
  }
  return out;
}
