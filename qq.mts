import { config } from "dotenv"; config({path:".env.local",quiet:true});
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const id=process.argv[2];
const r = await sql`select status, approved_at, plan->>'status' as ps, plan->>'approvedAt' as pa, version from contact_plans where case_id=${id}`;
console.log(JSON.stringify(r));
if(process.argv[3]==='reset'){
 await sql`update contact_plans set status='draft', approved_at=null, plan = (plan - 'approvedAt') || '{"status":"draft"}'::jsonb where case_id=${id}`;
 console.log(JSON.stringify(await sql`select status, approved_at, plan->>'status' as ps, plan->>'approvedAt' as pa from contact_plans where case_id=${id}`));
}
