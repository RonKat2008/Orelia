import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function fixturePath(name: string, offlineKey: string, root = process.cwd()): string {
  for (const seg of [name, offlineKey]) {
    if (!SAFE_SEGMENT.test(seg) || seg.includes("..")) {
      throw new Error(`Unsafe fixture path segment: ${JSON.stringify(seg)}`);
    }
  }
  return path.join(root, "fixtures", "llm", name, `${offlineKey}.json`);
}

/** Load a recorded model output and validate it with the same schema as the live path. */
export async function loadFixture<T>(
  name: string,
  offlineKey: string,
  schema: ZodType<T>,
  root?: string,
): Promise<T> {
  const file = fixturePath(name, offlineKey, root);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(`Offline fixture not found: ${file}. Record it with WAYFINDER_RECORD_LLM=1 and a live key.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Offline fixture ${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Offline fixture ${file} failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** RECORD mode: persist a validated live output as a fixture. */
export async function saveFixture(
  name: string,
  offlineKey: string,
  value: unknown,
  root?: string,
): Promise<string> {
  const file = fixturePath(name, offlineKey, root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}
