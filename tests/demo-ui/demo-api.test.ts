import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as statusGET } from "@/app/api/demo/status/route";
import { POST as seedPOST } from "@/app/api/demo/seed/route";
import { POST as repliesPOST } from "@/app/api/demo/replies/route";
import { POST as advancePOST } from "@/app/api/demo/advance/route";
import {
  replyPermitted,
  triggerScriptedReplies,
} from "@/app/api/demo/lib/actions";
import { addBusinessDays } from "@/lib/workflows/business-days";
import { DryRunMail } from "@/scripts/demo/dry-run-mail";
import { clearState } from "@/scripts/demo/state";

const CASE = "case-inbox@dry-run.agentmail.invalid";

describe("demo control API", () => {
  let dir: string;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-demo-ui-"));
    for (const key of ["WAYFINDER_DEMO", "WAYFINDER_DEMO_STATE", "OUTBOUND_ALLOWLIST", "DEMO_REPLY_ALLOWLIST", "WAYFINDER_SIM_TIME_SCALE", "AGENTMAIL_API_KEY"]) {
      prev[key] = process.env[key];
    }
    process.env.WAYFINDER_DEMO_STATE = path.join(dir, "state.json");
    process.env.WAYFINDER_DEMO = "1";
    process.env.WAYFINDER_SIM_TIME_SCALE = "1000000";
    delete process.env.OUTBOUND_ALLOWLIST;
    delete process.env.DEMO_REPLY_ALLOWLIST;
    delete process.env.AGENTMAIL_API_KEY;
    clearState();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("404s every demo route when WAYFINDER_DEMO is off", async () => {
    delete process.env.WAYFINDER_DEMO;
    for (const res of [await statusGET(), await seedPOST(), await repliesPOST(), await advancePOST()]) {
      expect(res.status).toBe(404);
    }
  });

  it("seeds a dry-run case and lists fictional destinations", async () => {
    const res = await seedPOST();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mode).toBe("dry-run");
    expect(body.caseId).toMatch(/epithelioid-sarcoma/);
    expect(body.destinations).toHaveLength(4);
    expect(body.destinations.every((d: { address: string }) => d.address.endsWith(".invalid"))).toBe(true);
    expect(body.allowlist.split(",")).toHaveLength(4);

    const status = await (await statusGET()).json();
    expect(status.seeded).toBe(true);
    expect(status.destinations[0].onOutboundAllowlist).toBe(false);
  });

  it("replies only to the reply allowlist", async () => {
    await seedPOST();
    const status = await (await statusGET()).json();
    const slides = status.destinations.find((d: { key: string }) => d.key === "slides");
    const mail = new DryRunMail();
    await mail.deliver(slides.address, {
      from: CASE,
      subject: "Appointment request",
      text: "Synthetic demo only.",
    });

    process.env.DEMO_REPLY_ALLOWLIST = CASE;
    const allowed = await triggerScriptedReplies(process.env, { mail, now: Date.now() + 60_000 });
    expect(allowed.replied).toBe(1);
    expect(mail.sent()).toHaveLength(1);
    expect(mail.sent()[0].to).toEqual([CASE]);

    const outsider = "real-clinic@hospital.org";
    expect(replyPermitted(outsider, process.env, status.destinations.map((d: { address: string }) => d.address))).toBe(false);
    expect(replyPermitted(CASE, process.env, [])).toBe(true);
  });

  it("sends nothing when the reply allowlist is empty", async () => {
    await seedPOST();
    const status = await (await statusGET()).json();
    const slides = status.destinations.find((d: { key: string }) => d.key === "slides");
    const mail = new DryRunMail();
    await mail.deliver(slides.address, { from: CASE, subject: "Hello", text: "Synthetic." });
    const res = await repliesPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replied).toBe(0);
    expect(mail.sent()).toHaveLength(0);
  });

  it("advances simulated time by three business days", async () => {
    const first = await advancePOST();
    const body = await first.json();
    const anchor = new Date(body.anchor);
    const step = addBusinessDays(anchor, 3).getTime() - anchor.getTime();
    expect(body.offsetMs).toBe(step);
    expect(body.day3FollowUpOpen).toBe(true);
    const second = await (await advancePOST()).json();
    expect(second.offsetMs).toBe(step * 2);
  });
});
