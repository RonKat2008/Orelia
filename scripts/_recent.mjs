import { neon } from "@neondatabase/serverless";
try {
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`select id, status, disease_name, created_at from cases where created_at > now() - interval '15 minutes' order by created_at desc`;
  console.log(rows.map((r) => `${r.id} ${r.status} ${r.disease_name} ${new Date(r.created_at).toISOString()}`).join("\n") || "none");
} catch (e) { console.error(String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "postgres://[redacted]")); process.exit(1); }
