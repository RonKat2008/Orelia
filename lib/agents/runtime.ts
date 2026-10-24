import Anthropic from "@anthropic-ai/sdk";
import { z, type ZodObject, type ZodRawShape, type ZodType } from "zod";
import { isOffline } from "@/lib/env";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";
import { loadFixture, saveFixture } from "./replay";
import type { RunStore } from "./run-store";

/** A typed tool wrapper exposed to the model as a Messages API tool. */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  handler: (input: never) => Promise<unknown>;
}

export interface RunAgentOptions<T> {
  name: string;
  model: string;
  system: string;
  prompt: string;
  tools: AgentTool[];
  output: ZodType<T>;
  caseId: string;
  store: RunStore;
  /** Fixture file stem under fixtures/llm/<name>/. */
  offlineKey: string;
  /** Max model round trips (default 12). */
  maxTurns?: number;
  /** Injectable Messages client for tests. */
  client?: MessagesClient;
}

const DEFAULT_MAX_TURNS = 12;
const MAX_TOKENS = 8192;

export class MedicalAdviceError extends Error {
  constructor(public readonly matches: string[]) {
    super(`Agent output flagged as medical advice: ${matches.join(" | ")}`);
    this.name = "MedicalAdviceError";
  }
}

function useOffline(): boolean {
  return isOffline(process.env.WAYFINDER_OFFLINE) || !process.env.ANTHROPIC_API_KEY;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

export function assertNoMedicalAdvice(output: unknown): void {
  const matches = collectStrings(output).flatMap((s) => flagMedicalAdvice(s).matches);
  if (matches.length > 0) throw new MedicalAdviceError([...new Set(matches)]);
}

function summarize(output: unknown): { counts: Record<string, number>; summary: string } {
  const counts: Record<string, number> = {};
  if (Array.isArray(output)) counts.items = output.length;
  else if (output && typeof output === "object") {
    for (const [k, v] of Object.entries(output)) if (Array.isArray(v)) counts[k] = v.length;
  }
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`);
  return { counts, summary: parts.length ? parts.join(", ") : "completed" };
}

/** Pull a JSON value out of model text: raw, fenced, or the outermost {...}/[...] span. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const open = trimmed.search(/[{[]/);
  const close = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (open >= 0 && close > open) candidates.push(trimmed.slice(open, close + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  throw new Error("No JSON value found in model output");
}

/** Minimal slice of the Anthropic client we use; real `Anthropic` satisfies it and tests can fake it. */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

let defaultClient: MessagesClient | undefined;
function getDefaultClient(): MessagesClient {
  defaultClient ??= new Anthropic();
  return defaultClient;
}

function toApiTools(tools: AgentTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.inputSchema, { target: "draft-7" }) as Anthropic.Tool.InputSchema,
  }));
}

async function runToolCall(tools: AgentTool[], block: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const tool = tools.find((t) => t.name === block.name);
  if (!tool) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Unknown tool: ${block.name}` };
  }
  try {
    const input = tool.inputSchema.parse(block.input);
    const result = await tool.handler(input as never);
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result ?? null) };
  } catch (e) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Tool error: ${(e as Error).message}` };
  }
}

/** Messages API tool-use loop. Only our tools are offered, so the model cannot touch anything else. */
async function queryOnce(opts: RunAgentOptions<unknown>, prompt: string): Promise<string> {
  const client = opts.client ?? getDefaultClient();
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const apiTools = toApiTools(opts.tools);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      ...(apiTools.length > 0 ? { tools: apiTools } : {}),
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      if (response.stop_reason === "max_tokens") throw new Error("Model output was truncated (max_tokens)");
      return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(toolUses.map((b) => runToolCall(opts.tools, b)));
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: results });
  }
  throw new Error(`Agent ${opts.name} exceeded maxTurns (${maxTurns}) without a final answer`);
}

async function runLive<T>(opts: RunAgentOptions<T>): Promise<T> {
  const first = await queryOnce(opts, opts.prompt);
  const firstTry = tryParse(first, opts.output);
  if (firstTry.ok) return firstTry.value;

  const retryPrompt =
    `${opts.prompt}\n\nYour previous reply could not be used: ${firstTry.error}\n` +
    `Reply again with ONLY valid JSON matching the required shape.`;
  const second = await queryOnce(opts, retryPrompt);
  const secondTry = tryParse(second, opts.output);
  if (secondTry.ok) return secondTry.value;
  throw new Error(`Agent ${opts.name} output failed validation after retry: ${secondTry.error}`);
}

function tryParse<T>(text: string, schema: ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

export async function runAgent<T>(opts: RunAgentOptions<T>): Promise<T> {
  const runId = await opts.store.create(opts.caseId, opts.name);
  await opts.store.update(runId, { status: "running", startedAt: new Date() });
  try {
    const offline = useOffline();
    const output = offline
      ? await loadFixture(opts.name, opts.offlineKey, opts.output)
      : await runLive(opts);
    assertNoMedicalAdvice(output);
    if (!offline && process.env.WAYFINDER_RECORD_LLM === "1") {
      await saveFixture(opts.name, opts.offlineKey, output);
    }
    const { counts, summary } = summarize(output);
    await opts.store.update(runId, { status: "done", counts, outputSummary: summary, finishedAt: new Date() });
    return output;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await opts.store.update(runId, { status: "failed", error: message, finishedAt: new Date() });
    throw e;
  }
}
