import { NextResponse } from "next/server";
import { z } from "zod";

export const idSchema = z.uuid();

export function jsonError(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
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
  if (!parsed.success) return { ok: false, response: jsonError(400, "Invalid body", z.treeifyError(parsed.error)) };
  return { ok: true, data: parsed.data };
}

export function parseId(id: string): string | null {
  const r = idSchema.safeParse(id);
  return r.success ? r.data : null;
}
