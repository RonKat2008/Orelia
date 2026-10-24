import { advanceSimulatedTime } from "../lib/actions";
import { demoError, demoJson } from "../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/demo/advance — move the demo clock forward three business days. */
export async function POST() {
  try {
    return demoJson(advanceSimulatedTime(process.env));
  } catch (error) {
    return demoError(error);
  }
}
