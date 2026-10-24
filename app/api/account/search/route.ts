import { fail, json, requireAccount } from "@/lib/accounts/http";
import { searchMedicalHistory } from "@/lib/accounts/retrieve";

export const runtime = "nodejs";

/** GET /api/account/search?q=&k= -> { results: MedicalHistoryHit[] } (the signed-in account's library only). */
export async function GET(req: Request) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length > 500) return fail(400, "invalid_query", "Enter a search between 1 and 500 characters");
  const k = Number(url.searchParams.get("k") ?? 8);
  try {
    return json({ results: await searchMedicalHistory(guard.account.id, q, Number.isFinite(k) ? k : 8) });
  } catch (err) {
    return fail(500, "search_failed", undefined, err);
  }
}
