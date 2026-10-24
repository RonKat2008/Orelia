import { NextResponse } from "next/server";
import { z } from "zod";

export const idSchema = z.uuid();

function describe(details: unknown): string {
  if (details instanceof Error) return `${details.name}: ${details.message}`;
  if (typeof details === "string") return details;
  return "non-error details omitted";
}

/**
 * Error response. `details` is logged server-side only (never returned; no stacks, no request bodies).
 * For 400s, `fields` lists invalid field paths so the UI can highlight them; nothing else leaves the server.
 */
export function jsonError(status: number, message: string, details?: unknown, fields?: string[]) {
  if (details !== undefined) console.error(`[api ${status}] ${message}`, describe(details));
  return NextResponse.json(fields && status === 400 ? { error: message, fields } : { error: message }, { status });
}

export function fieldPaths(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => i.path.map(String).join(".")).filter(Boolean))];
}

export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, "Body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: jsonError(400, "Invalid body", undefined, fieldPaths(parsed.error)) };
  return { ok: true, data: parsed.data };
}

export function parseId(id: string): string | null {
  const r = idSchema.safeParse(id);
  return r.success ? r.data : null;
}
