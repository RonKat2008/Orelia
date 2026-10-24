import { triggerScriptedReplies } from "../lib/actions";
import { demoError, demoJson } from "../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/demo/replies — scripted coordinator replies, allowlist only, dry-run mail. */
export async function POST() {
  try {
    return demoJson(await triggerScriptedReplies(process.env));
  } catch (error) {
    return demoError(error);
  }
}
