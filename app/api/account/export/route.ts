import { fail, requireAccount } from "@/lib/accounts/http";
import { exportAccount } from "@/lib/accounts/lifecycle";

export const runtime = "nodejs";

/** GET /api/account/export -> JSON download of everything Wayfinder holds for the account. */
export async function GET(req: Request) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  try {
    const data = await exportAccount(guard.account);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="wayfinder-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return fail(500, "export_failed", undefined, err);
  }
}
