import { readFileSync } from "node:fs";
import path from "node:path";
import { caseInputSchema, type CaseInput } from "@/lib/contracts";

export type DemoReport = {
  id: string;
  title: string;
  reportText: string;
  input: CaseInput;
};

const FILES = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"] as const;

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, stripNulls(entry)]),
    );
  }
  return value;
}

export function loadDemoReports(): DemoReport[] {
  const root = path.join(process.cwd(), "fixtures", "reports");
  return FILES.map((id) => {
    const reportText = readFileSync(path.join(root, `${id}.md`), "utf8");
    const raw = JSON.parse(readFileSync(path.join(root, "expected", `${id}.json`), "utf8")) as unknown;
    const input = caseInputSchema.parse(stripNulls(raw));
    return { id, title: input.diseaseName, reportText, input };
  });
}
