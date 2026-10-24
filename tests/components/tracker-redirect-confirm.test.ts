import { describe, expect, it, vi } from "vitest";
import { approveTask, loadTaskConfirmation, refusalMessages } from "@/components/outreach/client";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function asFetch(fn: unknown) {
  return fn as typeof fetch;
}

describe("redirect confirmation client", () => {
  it("sends confirmAddress when given", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const result = await approveTask("t1", asFetch(fetchImpl), { confirmAddress: "a@b.org" });
    expect(result).toEqual({ available: true, approved: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks/t1/approve");
    expect(JSON.parse(init.body as string)).toEqual({ confirmAddress: "a@b.org" });
  });

  it("keeps the empty body otherwise and feature-detects a missing route", async () => {
    const fetchImpl = vi.fn(async () => json({}, 404));
    const result = await approveTask("t1", asFetch(fetchImpl));
    expect(result.available).toBe(false);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("maps refusal reasons for the new codes", async () => {
    const fetchImpl = vi.fn(async () => json({ reasons: ["address_confirmation_mismatch", "redirect_unverified"] }, 422));
    const result = await approveTask("t1", asFetch(fetchImpl), { confirmAddress: "x" });
    expect(result).toEqual({
      available: true,
      approved: false,
      reasons: ["The address doesn't match the one in their reply.", "We couldn't verify which reply this came from."],
    });
    expect(refusalMessages(["address_confirmation_required", "redirect_address_not_in_reply"])).toEqual([
      "Please confirm the exact email address before approving.",
      "We couldn't find that address in their reply, so it can't be used.",
    ]);
  });

  it("loads the confirmation, and returns null on 404, no confirm, or network error", async () => {
    const ok = async () => json({ task: {}, confirm: { address: "a@b.org", quote: "write to a@b.org" } });
    expect(await loadTaskConfirmation("t1", asFetch(ok))).toEqual({ address: "a@b.org", quote: "write to a@b.org" });
    expect(await loadTaskConfirmation("t1", asFetch(async () => json({}, 404)))).toBeNull();
    expect(await loadTaskConfirmation("t1", asFetch(async () => json({ task: {} })))).toBeNull();
    expect(
      await loadTaskConfirmation(
        "t1",
        asFetch(async () => {
          throw new Error("offline");
        }),
      ),
    ).toBeNull();
  });
});
