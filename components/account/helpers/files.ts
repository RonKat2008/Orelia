import { ACCEPTED_TYPES, MAX_FILE_BYTES } from "@/lib/accounts/contract";

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Browsers report "" or odd types for some files; fall back to the extension. Null when unsupported. */
export function resolveContentType(file: Pick<FileLike, "name" | "type">): string | null {
  if (file.type && file.type in ACCEPTED_TYPES) return file.type;
  const ext = extensionOf(file.name);
  for (const [type, exts] of Object.entries(ACCEPTED_TYPES)) {
    if (exts.includes(ext)) return type;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Friendly rejection message, or null when the file can be staged. */
export function validateFile(file: FileLike): string | null {
  if (file.size <= 0) return `"${file.name}" is empty, so it was skipped.`;
  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)}. Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`;
  }
  if (!resolveContentType(file)) {
    return `"${file.name}" is not a type we can store. Use PDF, PNG, JPG, HEIC, TXT or DOCX.`;
  }
  return null;
}

export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const cleaned = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || name).slice(0, 200);
}

export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const tag = part.trim().slice(0, 40);
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}
