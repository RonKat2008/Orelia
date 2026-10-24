import { describe, expect, it } from "vitest";
import { draftSchema, inboundEventSchema } from "@/lib/contracts/message";

describe("messages", () => {
  it("parses email and voice drafts", () => {
    expect(draftSchema.parse({ channel: "email", to: "a@example.com", subject: "Hello", body: "Body" }).channel).toBe(
      "email",
    );
    expect(draftSchema.parse({ channel: "voice", toNumber: "+15555550100", script: "Hello" }).channel).toBe("voice");
  });

  it("rejects an email draft without a subject", () => {
    expect(draftSchema.safeParse({ channel: "email", to: "a@example.com", body: "Body" }).success).toBe(false);
  });

  it("parses an inbound event", () => {
    expect(
      inboundEventSchema.parse({
        channel: "email",
        contactId: "11111111-1111-4111-8111-111111111111",
        body: "Please send records",
        receivedAt: "2026-10-24T00:00:00.000Z",
      }).channel,
    ).toBe("email");
  });
});
