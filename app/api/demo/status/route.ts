import { demoError, demoJson } from "../lib/http";
import { demoStatus } from "../lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/demo/status — allowlisted test destinations and the simulated clock. */
export async function GET() {
  try {
    return demoJson(demoStatus(process.env));
  } catch (error) {
    return demoError(error);
  }
}
