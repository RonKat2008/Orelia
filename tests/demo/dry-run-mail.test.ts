import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMailDemoMail, createDemoMail, type AgentMailLike } from "../../scripts/demo/agentmail-mail";
import { DryRunMail } from "../../scripts/demo/dry-run-mail";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-demo-test-"));
  process.env.WAYFINDER_DEMO_STATE = path.join(dir, "state.json");
});
afterEach(() => {
  delete process.env.WAYFINDER_DEMO_STATE;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("DryRunMail", () => {
  it("creates, lists and deletes inboxes with .invalid addresses", async () => {
    const mail = new DryRunMail();
    const a = await mail.createInbox({ username: "alpha", displayName: "Alpha" });
    expect(a.address).toBe("alpha@dry-run.agentmail.invalid");
    expect((await mail.createInbox({ username: "alpha", displayName: "Alpha" })).inboxId).toBe(a.inboxId);
    expect(await mail.listInboxes()).toHaveLength(1);
    await mail.deleteInbox(a.inboxId);
    expect(await mail.listInboxes()).toHaveLength(0);
  });

  it("delivers and replies in-thread, persisting across instances", async () => {
    const one = new DryRunMail();
    const inbox = await one.createInbox({ username: "beta", displayName: "Beta" });
    const msg = await one.deliver(inbox.address, { from: "wayfinder@test.invalid", subject: "Hello", text: "Hi" });

    const two = new DryRunMail();
    const received = await two.listReceived(inbox.inboxId);
    expect(received).toHaveLength(1);
    expect(received[0].messageId).toBe(msg.messageId);

    await two.reply(inbox.inboxId, msg.messageId, "Thanks");
    const sent = new DryRunMail().sent();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: inbox.address,
      to: ["wayfinder@test.invalid"],
      threadId: msg.threadId,
      subject: "Re: Hello",
      text: "Thanks",
    });
  });

  it("rejects delivery to unknown inboxes and replies to unknown messages", async () => {
    const mail = new DryRunMail();
    await expect(mail.deliver("nobody@dry-run.agentmail.invalid", { from: "a", subject: "s", text: "t" })).rejects.toThrow();
    const inbox = await mail.createInbox({ username: "g", displayName: "G" });
    await expect(mail.reply(inbox.inboxId, "nope", "x")).rejects.toThrow();
  });
});

describe("createDemoMail", () => {
  it("picks the implementation from flags and key", () => {
    expect(createDemoMail({ env: {} }).mode).toBe("dry-run");
    expect(createDemoMail({ dryRun: true, env: { AGENTMAIL_API_KEY: "k" } }).mode).toBe("dry-run");
    expect(createDemoMail({ env: { AGENTMAIL_API_KEY: "k" } }).mode).toBe("agentmail");
  });
});

describe("AgentMailDemoMail (mocked client)", () => {
  it("maps responses and skips our own sent messages", async () => {
    const client = {
      inboxes: {
        create: vi.fn(async () => ({ inboxId: "i1", email: "u@agentmail.to", displayName: "U" })),
        list: vi.fn(async () => ({ inboxes: [{ inboxId: "i1", email: "u@agentmail.to", displayName: "U" }] })),
        delete: vi.fn(async () => undefined),
        messages: {
          list: vi.fn(async () => ({
            messages: [
              { inboxId: "i1", threadId: "t1", messageId: "m1", timestamp: new Date("2026-01-01T00:00:00Z"), from: "Orelia <w@x.test>", to: ["u@agentmail.to"], subject: "Hi" },
              { inboxId: "i1", threadId: "t1", messageId: "m2", timestamp: new Date("2026-01-01T00:01:00Z"), from: "U <u@agentmail.to>", to: ["w@x.test"], subject: "Re: Hi" },
            ],
          })),
          get: vi.fn(async () => ({ inboxId: "i1", threadId: "t1", messageId: "m1", timestamp: new Date("2026-01-01T00:00:00Z"), from: "Orelia <w@x.test>", to: ["u@agentmail.to"], subject: "Hi", text: "body" })),
          reply: vi.fn(async () => ({ messageId: "m3", threadId: "t1" })),
        },
      },
    };
    const mail = new AgentMailDemoMail({ client: client as unknown as AgentMailLike });
    expect(await mail.createInbox({ username: "u", displayName: "U" })).toEqual({ inboxId: "i1", address: "u@agentmail.to", displayName: "U" });
    expect(client.inboxes.create).toHaveBeenCalledWith({ username: "u", displayName: "U" });
    expect(await mail.listInboxes()).toHaveLength(1);
    const received = await mail.listReceived("i1");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ messageId: "m1", text: "body", receivedAt: "2026-01-01T00:00:00.000Z" });
    expect(await mail.reply("i1", "m1", "yo")).toEqual({ messageId: "m3" });
    expect(client.inboxes.messages.reply).toHaveBeenCalledWith("i1", "m1", { text: "yo" });
    await mail.deleteInbox("i1");
    expect(client.inboxes.delete).toHaveBeenCalledWith("i1");
  });
});
