import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MemoryRunStore } from "@/lib/agents/run-store";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent, extractJson, type AgentTool, type MessagesClient } from "@/lib/agents/runtime";
import { HAIKU } from "@/lib/agents/models";

type Params = Anthropic.MessageCreateParamsNonStreaming;
const sdk = {
  replies: [] as Array<Partial<Anthropic.Message>>,
  calls: [] as Params[],
};
const fakeClient: MessagesClient = {
  messages: {
    create: async (params) => {
      sdk.calls.push(structuredClone(params));
      const next = sdk.replies.shift() ?? text("{}");
      return next as Anthropic.Message;
    },
  },
};
function text(t: string): Partial<Anthropic.Message> {
  return { stop_reason: "end_turn", content: [{ type: "text", text: t, citations: null }] as Anthropic.Message["content"] };
}
function toolUse(id: string, name: string, input: unknown): Partial<Anthropic.Message> {
  return { stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] as Anthropic.Message["content"] };
}

const schema = z.object({ items: z.array(z.object({ title: z.string() })) });
const tools: AgentTool[] = [
  { name: "search", description: "d", inputSchema: z.object({ q: z.string() }), handler: async () => ({}) },
];

let root: string;
let cwd: string;
const store = () => new MemoryRunStore();

function base(s: MemoryRunStore, key = "case1") {
  return { name: "trials", model: HAIKU, system: "sys", prompt: "go", tools, output: schema, caseId: "c1", store: s, offlineKey: key, client: fakeClient };
}

async function writeFixtureFile(key: string, body: string) {
  const dir = path.join(root, "fixtures", "llm", "trials");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${key}.json`), body);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "wf-runtime-"));
  cwd = process.cwd();
  process.chdir(root);
  sdk.replies.length = 0;
  sdk.calls.length = 0;
  vi.stubEnv("WAYFINDER_OFFLINE", "1");
  vi.stubEnv("WAYFINDER_RECORD_LLM", "");
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("runAgent offline replay", () => {
  it("validates the fixture and moves the run queued -> done with counts", async () => {
    await writeFixtureFile("case1", JSON.stringify({ items: [{ title: "a" }, { title: "b" }] }));
    const s = store();
    const out = await runAgent(base(s));
    expect(out.items).toHaveLength(2);
    const [run] = await s.listByCase("c1");
    expect(run).toMatchObject({ agent: "trials", status: "done", counts: { items: 2 }, outputSummary: "2 items" });
    expect(run?.startedAt).toBeInstanceOf(Date);
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(sdk.calls).toHaveLength(0);
  });

  it("fails the run when the fixture does not match the schema", async () => {
    await writeFixtureFile("case1", JSON.stringify({ items: [{ nope: 1 }] }));
    const s = store();
    await expect(runAgent(base(s))).rejects.toThrow(/failed validation/);
    const [run] = await s.listByCase("c1");
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/failed validation/);
  });

  it("fails the run when the fixture is missing", async () => {
    const s = store();
    await expect(runAgent(base(s, "absent"))).rejects.toThrow(/not found/);
    expect((await s.listByCase("c1"))[0]?.status).toBe("failed");
  });

  it("fails the run (no silent strip) when output contains medical advice", async () => {
    await writeFixtureFile("case1", JSON.stringify({ items: [{ title: "You should take 50 mg daily" }] }));
    const s = store();
    await expect(runAgent(base(s))).rejects.toThrow(/medical advice/);
    const [run] = await s.listByCase("c1");
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/medical advice/);
  });

  it("rejects path traversal in offlineKey", async () => {
    const s = store();
    await expect(runAgent(base(s, "../evil"))).rejects.toThrow(/Unsafe fixture/);
  });
});

describe("runAgent live path (SDK mocked)", () => {
  beforeEach(() => {
    vi.stubEnv("WAYFINDER_OFFLINE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  });

  it("sends only our tools as JSON Schema with a cached system prompt and parses fenced JSON", async () => {
    sdk.replies.push(text('Here:\n```json\n{"items":[{"title":"x"}]}\n```'));
    const s = store();
    const out = await runAgent(base(s));
    expect(out.items[0]?.title).toBe("x");
    const params = sdk.calls[0]!;
    expect(params.model).toBe(HAIKU);
    expect(params.tools).toHaveLength(1);
    expect(params.tools?.[0]).toMatchObject({ name: "search", input_schema: { type: "object", properties: { q: { type: "string" } } } });
    expect(params.system).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
    expect((await s.listByCase("c1"))[0]?.status).toBe("done");
  });

  it("runs a tool_use round trip and feeds the tool_result back", async () => {
    const handler = vi.fn(async (input: { q: string }) => ({ hit: input.q }));
    const t: AgentTool[] = [{ ...tools[0]!, handler: handler as AgentTool["handler"] }];
    sdk.replies.push(toolUse("tu_1", "search", { q: "ehlers" }), text('{"items":[{"title":"done"}]}'));
    const out = await runAgent({ ...base(store()), tools: t });
    expect(out.items[0]?.title).toBe("done");
    expect(handler).toHaveBeenCalledWith({ q: "ehlers" });
    const followUp = sdk.calls[1]!.messages;
    expect(followUp.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: JSON.stringify({ hit: "ehlers" }) }],
    });
  });

  it("returns a thrown tool handler error to the model with is_error", async () => {
    const t: AgentTool[] = [{ ...tools[0]!, handler: async () => { throw new Error("rate limited"); } }];
    sdk.replies.push(toolUse("tu_2", "search", { q: "x" }), text('{"items":[]}'));
    await runAgent({ ...base(store()), tools: t });
    const block = (sdk.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(block).toMatchObject({ tool_use_id: "tu_2", is_error: true });
    expect(block.content).toMatch(/rate limited/);
  });

  it("marks is_error for invalid tool input and unknown tools", async () => {
    sdk.replies.push(toolUse("tu_3", "search", { q: 5 }), toolUse("tu_4", "nope", {}), text('{"items":[]}'));
    await runAgent(base(store()));
    expect((sdk.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!.is_error).toBe(true);
    expect((sdk.calls[2]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!.is_error).toBe(true);
  });

  it("fails the run when maxTurns is exceeded", async () => {
    for (let i = 0; i < 5; i++) sdk.replies.push(toolUse(`t${i}`, "search", { q: "x" }));
    const s = store();
    await expect(runAgent({ ...base(s), maxTurns: 3 })).rejects.toThrow(/exceeded maxTurns \(3\)/);
    expect(sdk.calls).toHaveLength(3);
    expect((await s.listByCase("c1"))[0]?.status).toBe("failed");
  });

  it("retries once with the zod error, then succeeds", async () => {
    sdk.replies.push(text('{"items":[{"bad":1}]}'), text('{"items":[{"title":"ok"}]}'));
    const out = await runAgent(base(store()));
    expect(out.items[0]?.title).toBe("ok");
    expect(sdk.calls).toHaveLength(2);
    expect(JSON.stringify(sdk.calls[1]!.messages[0])).toMatch(/could not be used/);
  });

  it("throws after a second parse failure and marks the run failed", async () => {
    sdk.replies.push(text("not json"), text("still not json"));
    const s = store();
    await expect(runAgent(base(s))).rejects.toThrow(/after retry/);
    expect((await s.listByCase("c1"))[0]?.status).toBe("failed");
  });

  it("fails on medical advice in live output", async () => {
    sdk.replies.push(text(JSON.stringify({ items: [{ title: "We recommend starting chemotherapy" }] })));
    const s = store();
    await expect(runAgent(base(s))).rejects.toThrow(/medical advice/);
    expect((await s.listByCase("c1"))[0]?.status).toBe("failed");
  });

  it("records live output when WAYFINDER_RECORD_LLM=1", async () => {
    vi.stubEnv("WAYFINDER_RECORD_LLM", "1");
    sdk.replies.push(text('{"items":[{"title":"rec"}]}'));
    await runAgent(base(store(), "rec1"));
    const saved = await readFile(path.join(root, "fixtures/llm/trials/rec1.json"), "utf8");
    expect(JSON.parse(saved)).toEqual({ items: [{ title: "rec" }] });
  });

  it("falls back to offline when no API key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await writeFixtureFile("case1", JSON.stringify({ items: [] }));
    const out = await runAgent(base(store()));
    expect(out.items).toEqual([]);
    expect(sdk.calls).toHaveLength(0);
  });
});

describe("extractJson", () => {
  it("extracts an object surrounded by prose", () => {
    expect(extractJson('sure {"a":1} done')).toEqual({ a: 1 });
  });
});
