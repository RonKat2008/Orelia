import { describe, expect, it } from "vitest";
import { AI_DISCLOSURE_EMAIL } from "../../lib/safety/disclosure";
import { CLINICAL_NOTICE, disclosureFor, looksClinical, parseThreads } from "../../components/threads/model";
import { loadThreads } from "../../components/threads/load";

describe("threads", () => {
  it("flags clinical wording and keeps the safety sentence exact", () => {
    expect(looksClinical("Can you describe the symptoms and fever?")).toBe(true);
    expect(looksClinical("Please send the referral packet.")).toBe(false);
    expect(CLINICAL_NOTICE).toBe(
      "Wayfinder can't give medical advice. Contact your care team or call 911 for urgent symptoms.",
    );
  });

  it("parses outbound fields, disclosure, inbound replies, transcripts, and tasks", () => {
    const threads = parseThreads({
      threads: [
        {
          contactId: "c1",
          label: "Intake",
          messages: [
            {
              id: "m1",
              direction: "outbound",
              channel: "email",
              subject: "Second opinion request",
              body: `Hello\n\n${AI_DISCLOSURE_EMAIL}`,
              sharedFields: ["diseaseName"],
              sentAt: "2026-10-24T15:00:00.000Z",
            },
            {
              id: "m2",
              direction: "inbound",
              channel: "email",
              body: "What symptoms should we expect?",
              classification: { class: "send_records", rationale: "They asked for records." },
              task: { id: "t1", kind: "records", status: "open", summary: "Send the records packet." },
            },
            {
              id: "m3",
              direction: "inbound",
              transcript: "Coordinator confirmed the intake desk hours.",
            },
          ],
        },
      ],
    });
    expect(threads).toHaveLength(1);
    expect(threads[0].entries[0].sharedFields).toEqual(["diseaseName"]);
    expect(disclosureFor(threads[0].entries[0])).toBe(AI_DISCLOSURE_EMAIL);
    expect(threads[0].entries[1].clinical).toBe(true);
    expect(threads[0].entries[1].task?.id).toBe("t1");
    expect(threads[0].entries[2].channel).toBe("voice");
  });

  it("treats a missing threads route as not available", async () => {
    const fetchImpl = async () => new Response("missing", { status: 404 });
    await expect(loadThreads("case-1", fetchImpl as typeof fetch)).resolves.toEqual({ status: "unavailable" });
  });

  it("returns parsed threads when the route answers", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ threads: [{ contactId: "c1", messages: [{ id: "m", direction: "inbound", body: "Received." }] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await loadThreads("case-1", fetchImpl as typeof fetch);
    expect(result.status).toBe("ok");
    expect(result.threads?.[0].entries[0].body).toBe("Received.");
  });
});
