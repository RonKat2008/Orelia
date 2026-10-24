import { describe, expect, it } from "vitest";
import { OUTBOX_COPY } from "@/components/patient/views/outbox/copy";
import { consentName, outboxKey, outboxScreen } from "@/components/patient/views/outbox/model";
import type { NextActionKind, PatientStatus } from "@/lib/patient-status/types";

const withAction = (kind: NextActionKind, headline = "h", extra = {}): PatientStatus => ({
  headline,
  step: "reach",
  tone: "you",
  updatedAt: "2026-10-24T00:00:00Z",
  nextAction: { kind, label: "x", detailsHref: "/", ...extra },
});

describe("outboxScreen", () => {
  it("maps next actions to one screen", () => {
    expect(outboxScreen(withAction("approve_message"))).toBe("message");
    expect(outboxScreen(withAction("approve_application"))).toBe("form");
    expect(outboxScreen(withAction("share_details"))).toBe("consent");
    expect(outboxScreen(withAction("approve_plan"))).toBe("empty");
    expect(outboxScreen({ headline: "h", step: "reach", tone: "waiting", updatedAt: "" })).toBe("empty");
  });
});

describe("consentName", () => {
  it("reads the name from the headline", () => {
    expect(consentName(withAction("share_details", "Choose what we may share with The EDS Society."))).toBe("The EDS Society");
    expect(consentName(withAction("share_details", "Choose what we may share with the 2 people you picked."))).toBe("the 2 people you picked");
  });
  it("falls back to a neutral word", () => {
    expect(consentName(withAction("share_details", "Something else"))).toBe("them");
  });
});

describe("outboxKey", () => {
  it("changes with the contact, so a new message starts fresh", () => {
    expect(outboxKey(withAction("approve_message", "h", { contactId: "a" }))).not.toBe(outboxKey(withAction("approve_message", "h", { contactId: "b" })));
  });
});

describe("copy", () => {
  it("matches the spec's non-red consent state", () => {
    expect(OUTBOX_COPY.title).toBe("Messages to check");
    expect(OUTBOX_COPY.consentTitle).toBe("We need one more answer first");
    expect(OUTBOX_COPY.consentBody("The EDS Society")).toBe("Tell The EDS Society what they may see, then we'll write the email.");
    expect(OUTBOX_COPY.consentPrimary).toBe("Choose what to share");
  });
});
