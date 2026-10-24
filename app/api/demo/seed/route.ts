import { rejectCrossOrigin } from "@/lib/auth/origin";
import { requireDemo } from "../lib/guard";
import { seedDemoCase } from "../lib/actions";
import { demoError, demoJson } from "../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/demo/seed — dry-run demo case and fictional coordinator inboxes. */
export async function POST(request: Request) {
  try {
    requireDemo(process.env);
    const csrf = rejectCrossOrigin(request);
    if (csrf) return csrf;
    return demoJson(await seedDemoCase(process.env), 201);
  } catch (error) {
    return demoError(error);
  }
}
