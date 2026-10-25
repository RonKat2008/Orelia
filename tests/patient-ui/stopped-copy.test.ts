import { describe, expect, it } from "vitest";
import { stoppedCopy } from "@/components/patient/actions/stopped-copy";

describe("what the patient is told when a send does not go through", () => {
  it("never says nothing was sent when the provider may have sent it", () => {
    const copy = stoppedCopy(["send_status_unknown"]);
    expect(copy.title).not.toMatch(/safety/i);
    expect(copy.detail).not.toMatch(/nothing was sent/i);
    expect(copy.detail).toMatch(/not be sent a second time/i);
  });
  it("names the email or phone service, not the safety check, when the provider refused", () => {
    const copy = stoppedCopy(["send_rejected"]);
    expect(copy.title).not.toMatch(/safety/i);
    expect(copy.detail).toMatch(/nothing was sent/i);
  });
  it("keeps the safety-check wording for gate refusals", () => {
    expect(stoppedCopy(["not_allowlisted"]).title).toMatch(/safety check/i);
    expect(stoppedCopy([]).title).toMatch(/safety check/i);
  });
});
