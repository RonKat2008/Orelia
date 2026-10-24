import { describe, expect, it } from "vitest";
import { caseInputSchema } from "@/lib/contracts";
import { MAX_UPLOAD_BYTES, NEEDS_REVIEW, checkUpload, fallbackFor } from "@/components/intake/fallback";
import { loadDemoReports } from "@/components/intake/demos";

describe("intake fallback", () => {
  const demos = loadDemoReports();

  it("ships the three sample cases", () => {
    expect(demos).toHaveLength(3);
  });

  it("matches a pasted sample to its saved details", () => {
    const sample = demos[1];
    expect(fallbackFor(sample.reportText, demos)).toEqual(sample.input);
  });

  it("returns a schema-valid placeholder for unknown text", () => {
    const input = fallbackFor("some unrelated note", demos);
    expect(input.diseaseName).toBe(NEEDS_REVIEW);
    expect(caseInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("checkUpload", () => {
  it("accepts small text files", () => {
    expect(checkUpload({ name: "report.md", size: 1200, type: "" }).ok).toBe(true);
  });

  it("rejects non-text, oversized and empty files with a reason", () => {
    expect(checkUpload({ name: "scan.png", size: 100, type: "image/png" }).ok).toBe(false);
    expect(checkUpload({ name: "r.txt", size: MAX_UPLOAD_BYTES + 1, type: "text/plain" }).ok).toBe(false);
    const empty = checkUpload({ name: "r.txt", size: 0, type: "text/plain" });
    expect(empty.ok).toBe(false);
  });
});
