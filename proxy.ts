import { NextResponse, type NextRequest } from "next/server";
import { getConsultService } from "@/lib/coordination/consult";
import { accountsEnabled, getNeonAuth } from "@/lib/auth/neon";

/**
 * /review/[token] must answer 404 for an unknown, forged, expired, cancelled or already-decided link. The page
 * itself also calls notFound(), but app/review/loading.tsx makes the page stream, so by then the status is already 200.
 * Deciding here, before rendering starts, gives a real 404 status (and the standard not-found page) with the same
 * lookup the API uses. A lookup failure (not a miss) passes through so the client form can show its retry state.
 */
export async function proxy(request: NextRequest) {
  if (/^\/review\/[^/]+\/?$/.test(request.nextUrl.pathname)) {
    try {
      const token = decodeURIComponent(request.nextUrl.pathname.split("/")[2] ?? "");
      if ((await getConsultService().reviewView(token)) === null) {
        return NextResponse.rewrite(new URL("/review-not-found", request.url), { status: 404 });
      }
    } catch {
      // Lookup failures pass through to the review form's retry state.
    }
  }

  // Neon returns an OAuth verifier to the chosen page, where its SDK exchanges
  // the challenge for session cookies. Run auth middleware only for that exchange:
  // its normal route protection would otherwise redirect anonymous case visitors.
  const oauthReturn = request.nextUrl.searchParams.has("neon_auth_session_verifier");
  const hasChallenge = request.cookies.has("__Secure-neon-auth.session_challenge")
    || request.cookies.has("__Secure-neon-auth.session_challange");
  if (oauthReturn && hasChallenge && accountsEnabled()) {
    try {
      const auth = await getNeonAuth();
      const response = await auth.middleware()(request);
      // The SDK's failed-exchange login redirect can retain the verifier. It must
      // not remain in navigation URLs after the exchange attempt.
      const location = response.headers.get("location");
      if (location) {
        const destination = new URL(location, request.url);
        destination.searchParams.delete("neon_auth_session_verifier");
        response.headers.set("location", destination.toString());
      }
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch {
      return NextResponse.redirect(new URL("/auth/sign-in", request.url), {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/review/:token",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
  ],
};
