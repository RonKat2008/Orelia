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
    return Response.json({ error: "Accounts are not available" }, { status: 404 });
  }
  return auth.handler()[method](req, ctx);
}

export const GET = (req: Request, ctx: Ctx) => handle("GET", req, ctx);
export const POST = (req: Request, ctx: Ctx) => handle("POST", req, ctx);
