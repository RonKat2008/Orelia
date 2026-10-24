import { seedDemoCase } from "../lib/actions";
import { demoError, demoJson } from "../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/demo/seed — dry-run demo case and fictional coordinator inboxes. */
export async function POST() {
  try {
    return demoJson(await seedDemoCase(process.env), 201);
  } catch (error) {
    return demoError(error);
  }
}
