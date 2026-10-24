export interface InboundReplyContactPoint {
  id: string;
  claimType: 'contact_point.email.inbound_reply';
  claim: string;
  sourceUrl: string;
  sourceKind: 'inbound_reply';
  fetchedAt: string;
}

/** Evidence row for an address the patient confirmed and that appears literally in a stored inbound reply. */
export function inboundReplyContactPoint(input: { channel: 'email'; address: string; messageId: string; receivedAt?: string }): InboundReplyContactPoint {
  return {
    id: `contact_point:inbound_reply:${input.address}:${input.messageId}`,
    claimType: 'contact_point.email.inbound_reply',
    claim: input.address,
    sourceUrl: `urn:wayfinder:message:${input.messageId}`,
    sourceKind: 'inbound_reply',
    fetchedAt: input.receivedAt ?? new Date().toISOString(),
  };
}
