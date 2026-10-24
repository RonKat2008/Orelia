import { NextResponse, type NextRequest } from "next/server";
import { getConsultService } from "@/lib/coordination/consult";

/**
 * /review/[token] must answer 404 for an unknown, forged, expired, cancelled or already-decided link. The page
 * itself also calls notFound(), but app/review/loading.tsx makes the page stream, so by then the status is already 200.
 * Deciding here, before rendering starts, gives a real 404 status (and the standard not-found page) with the same
 * lookup the API uses. A lookup failure (not a miss) passes through so the client form can show its retry state.
 */
export async function proxy(request: NextRequest) {
  const token = decodeURIComponent(request.nextUrl.pathname.split("/")[2] ?? "");
  try {
    if ((await getConsultService().reviewView(token)) === null) {
      return NextResponse.rewrite(new URL("/review-not-found", request.url), { status: 404 });
    }
  } catch {
    // fall through
  }
  return NextResponse.next();
}

export const config = { matcher: "/review/:token" };
