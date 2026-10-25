import { getNeonAuth } from "@/lib/auth/neon";
import { rejectCrossOrigin } from "@/lib/auth/origin";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

/** Neon Auth (Better Auth) proxy: sign-up, sign-in, OAuth callbacks, password reset, session. 404 when not configured. */
async function handle(method: "GET" | "POST", req: Request, ctx: Ctx): Promise<Response> {
  // Sign-in/up/reset POSTs come from our own pages; OAuth callbacks are GET navigations.
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  let auth;
  try {
    auth = await getNeonAuth();
  } catch {
    return Response.json({ error: "Accounts are not available", code: "AUTH_UNAVAILABLE", message: "Accounts are not available right now. You can still start a case without an account." }, { status: 404 });
  }
  try {
    return await auth.handler()[method](req, ctx);
  } catch (error) {
    console.error("[auth] account service request failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ code: "AUTH_UNAVAILABLE", message: "The account service is temporarily unavailable. Please try again." }, { status: 503 });
  }
}

export const GET = (req: Request, ctx: Ctx) => handle("GET", req, ctx);
export const POST = (req: Request, ctx: Ctx) => handle("POST", req, ctx);
