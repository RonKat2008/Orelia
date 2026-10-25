import { describe, expect, it, vi } from "vitest";
import { approvalNotice, noticeHasHealthDetails, notifyPending, signApprovalToken, verifyApprovalToken } from "../../lib/notify";
import type { NotifyCaseState, NotifyMailer } from "../../lib/notify";

const CASE = "11111111-1111-4111-8111-111111111111";
const SECRET = "test-secret";
const base: NotifyCaseState = { optIn: true, patientEmail: "patient@example.com", homeState: "CA", lastSentAt: null, lastDigestOn: null };

function req(over: Record<string, unknown> = {}, mailer?: NotifyMailer) {
  const send = vi.fn(async () => ({ id: "m-1" }));
  return {
    send,
    input: {
      caseId: CASE, pendingCount: 2, state: base, now: new Date("2026-06-15T18:00:00.000Z"),
      mode: "dev" as const, allowlist: ["patient@example.com"], appBaseUrl: "https://wayfinder.test",
      linkSecret: SECRET, kind: "immediate" as const, mailer: mailer ?? { send }, ...over,
    },
  };
}

describe("patient approval notifications", () => {
  it("sends one debounced notice with no health text", async () => {
    const first = req();
    const sent = await notifyPending(first.input);
    expect(sent.sent).toBe(true);
    if (!sent.sent) return;
    expect(sent.text.startsWith("You have 2 item(s) waiting for your approval in Orelia.")).toBe(true);
    expect(noticeHasHealthDetails(sent.text)).toBe(false);
    expect(sent.text).not.toContain("synthetic");
    expect(first.send).toHaveBeenCalledTimes(1);
    const second = req({ state: { ...base, lastSentAt: new Date("2026-06-15T17:30:00.000Z") } });
    const again = await notifyPending(second.input);
    expect(again).toEqual({ sent: false, reason: "debounced" });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("holds the notice during quiet hours in the patient home-state timezone", async () => {
    const quiet = req({ now: new Date("2026-06-15T05:30:00.000Z") }); // 10:30pm PDT
    expect(await notifyPending(quiet.input)).toEqual({ sent: false, reason: "quiet_hours" });
    const morning = req({ now: new Date("2026-06-15T16:00:00.000Z") }); // 9:00am PDT
    expect((await notifyPending(morning.input)).sent).toBe(true);
  });

  it("refuses a patient address that is not allowlisted in dev", async () => {
    const blocked = req({ allowlist: ["other@example.com"] });
    expect(await notifyPending(blocked.input)).toEqual({ sent: false, reason: "not_allowlisted" });
    expect(blocked.send).not.toHaveBeenCalled();
  });

  it("sends a daily digest once while items stay pending", async () => {
    const digest = req({ kind: "digest", state: { ...base, lastSentAt: new Date("2026-06-14T18:00:00.000Z"), lastDigestOn: "2026-06-14" } });
    const sent = await notifyPending(digest.input);
    expect(sent.sent).toBe(true);
    if (!sent.sent) return;
    const repeat = req({ kind: "digest", state: { ...base, lastDigestOn: sent.lastDigestOn } });
    expect(await notifyPending(repeat.input)).toEqual({ sent: false, reason: "digest_already_sent" });
  });

  it("signs a link that expires", () => {
    const notice = approvalNotice(1, "https://wayfinder.test/cases/x/outbox?approval=abc");
    expect(notice.text).toContain("1 item(s)");
    const signed = signApprovalToken(CASE, new Date("2026-06-15T18:00:00.000Z"), SECRET);
    expect(verifyApprovalToken(signed.token, SECRET, new Date("2026-06-16T18:00:00.000Z"))).toEqual({ ok: true, caseId: CASE });
    expect(verifyApprovalToken(signed.token, SECRET, new Date("2026-06-23T18:00:01.000Z")).ok).toBe(false);
  });
});
