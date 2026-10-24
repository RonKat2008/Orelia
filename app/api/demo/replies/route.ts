import { rejectCrossOrigin } from "@/lib/auth/origin";
import { requireDemo } from "../lib/guard";
import { triggerScriptedReplies } from "../lib/actions";
import { demoError, demoJson } from "../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/demo/replies — scripted coordinator replies, allowlist only, dry-run mail. */
export async function POST(request: Request) {
  try {
    requireDemo(process.env);
    const csrf = rejectCrossOrigin(request);
    if (csrf) return csrf;
    return demoJson(await triggerScriptedReplies(process.env));
  } catch (error) {
    return demoError(error);
  }
}
