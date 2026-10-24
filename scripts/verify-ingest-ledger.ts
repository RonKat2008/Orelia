/**
 * Verifies the recoverable webhook ingest against the REAL Postgres named by DATABASE_URL.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/verify-ingest-ledger.ts
 *
 * Creates one synthetic case + contact + outbound thread, then drives the real AgentMail webhook handler with
 * the real Postgres deps (offline classifier; a throwaway signing secret, so no provider is involved):
 *   1. ingest fails once  -> 500, message stored, not ingested, lease released, no tasks, contact still 'sent'
 *   2. two concurrent ledger claims -> exactly one wins
 *   3. provider retry      -> 200, tasks created once, contact 'replied', ingested_at set
 *   4. another redelivery  -> 200 duplicate, no new tasks
 *   5. call transcript ledger: concurrent claims -> one wins; complete -> done
 * Deletes the case (cascade) in a finally block and checks for leftover rows. Sends nothing.
 */
import { neon } from "@neondatabase/serverless";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleAgentMailWebhook } from "../app/api/webhooks/_lib/inbound";
import { postgresInboundDeps } from "../app/api/webhooks/_lib/postgres";

const DAY_MS = 24 * 60 * 60 * 1000;
const fail = (msg: string): never => { throw new Error(`ASSERTION FAILED: ${msg}`); };

function signed(body: string, secret: string, id: string): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.slice(6), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("https://verify.invalid/api/webhooks/agentmail", {
    method: "POST", body,
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" },
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (source .env.local first)");
  const address = (process.env.DEMO_COORDINATOR_INBOXES ?? "").split(",").map(a => a.trim()).find(a => a.includes("@"));
  if (!address) throw new Error("DEMO_COORDINATOR_INBOXES has no email address");
  const sql = neon(url);
  const secret = `whsec_${randomBytes(24).toString("base64")}`;
  const caseId = randomUUID();
  const contactId = randomUUID();
  const threadId = `zz-verify-thread-${randomUUID()}`;
  const messageId = `zz-verify-msg-${randomUUID()}`;
  const callId = `zz-verify-call-${randomUUID()}`;
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "inbox", "01-needs-referral-basic.json"), "utf8")) as { event: { body: string } };
  const body = JSON.stringify({ type: "event", event_type: "message.received", event_id: `evt-${randomUUID()}`, message: {
    inbox_id: "zz-verify-inbox", thread_id: threadId, message_id: messageId, from: address, subject: "Re: synthetic",
    text: fixture.event.body, timestamp: new Date().toISOString() } });
  const env = { ...process.env, WAYFINDER_OFFLINE: "1", AGENTMAIL_WEBHOOK_SECRET: secret, INNGEST_EVENT_KEY: "", INNGEST_SIGNING_KEY: "" };
  const now = Date.now();
  let verdict = "NOT RUN";
  try {
    await sql`insert into cases (id, disease_name, status) values (${caseId}::uuid, 'ZZ ingest ledger verification (synthetic)', 'unconfirmed')`;
    await sql`insert into contacts (id, case_id, target_kind, target_id, channel, address, state, first_sent_at, last_activity_at, follow_ups_sent)
      values (${contactId}::uuid, ${caseId}::uuid, 'organization', ${randomUUID()}::uuid, 'email', ${address}, 'sent',
        ${new Date(now - DAY_MS).toISOString()}::timestamptz, ${new Date(now - DAY_MS).toISOString()}::timestamptz, 0)`;
    await sql`insert into messages (contact_id, direction, channel, subject, body, approved_at, sent_at, classification, provider_thread_id, provider_message_id)
      values (${contactId}::uuid, 'outbound', 'email', 'ZZ synthetic intro', 'synthetic first message', ${new Date(now - DAY_MS).toISOString()}::timestamptz,
        ${new Date(now - DAY_MS).toISOString()}::timestamptz, 'initial', ${threadId}, ${`zz-out-${randomUUID()}`})`;

    const deps = postgresInboundDeps("agentmail", env);
    const realIngest = deps.ingestInbound;
    let attempts = 0;
    deps.ingestInbound = async (e) => { attempts++; if (attempts === 1) throw new Error("simulated classifier outage"); return realIngest(e); };
    const state = async () => {
      const [m] = (await sql`select ingested_at is not null as ingested, ingest_claimed_at is not null as claimed from messages where provider_message_id = ${messageId}`) as { ingested: boolean; claimed: boolean }[];
      const [c] = (await sql`select state from contacts where id = ${contactId}::uuid`) as { state: string }[];
      const [t] = (await sql`select count(*)::int as n, count(*) filter (where source_id = ${`email:${messageId}`})::int as tagged from tasks where contact_id = ${contactId}::uuid`) as { n: number; tagged: number }[];
      return { message: m, contact: c?.state, tasks: t };
    };

    const r1 = await handleAgentMailWebhook(signed(body, secret, "msg_1"), deps);
    const s1 = await state();
    console.log("1. failed ingest:", r1.status, JSON.stringify(s1));
    if (r1.status !== 500) fail(`expected 500, got ${r1.status}`);
    if (!s1.message || s1.message.ingested || s1.message.claimed) fail("message should be stored, not ingested, lease released");
    if (s1.tasks.n !== 0 || s1.contact !== "sent") fail("no tasks / contact still sent expected");

    const key = { kind: "email" as const, providerMessageId: messageId };
    const claims = await Promise.all([deps.ingestLedger.claim(key), deps.ingestLedger.claim(key)]);
    console.log("2. concurrent claims:", JSON.stringify(claims));
    if (claims.filter(c => c === "claimed").length !== 1 || !claims.includes("busy")) fail("expected exactly one claimed + one busy");
    const busy = await handleAgentMailWebhook(signed(body, secret, "msg_busy"), deps);
    console.log("   delivery while claimed:", busy.status, JSON.stringify(await busy.json()));
    if (busy.status !== 503) fail(`expected 503 while claimed, got ${busy.status}`);
    await deps.ingestLedger.release(key);

    const r2 = await handleAgentMailWebhook(signed(body, secret, "msg_2"), deps);
    const s2 = await state();
    console.log("3. retry:", r2.status, JSON.stringify(await r2.json()), JSON.stringify(s2));
    if (r2.status !== 200 || !s2.message?.ingested || s2.message.claimed) fail("retry should ingest and mark ingested_at");
    if (s2.tasks.n < 1 || s2.tasks.tagged !== s2.tasks.n) fail(`expected tasks tagged with the source, got ${JSON.stringify(s2.tasks)}`);
    if (s2.contact !== "replied") fail(`contact should be replied, got ${s2.contact}`);

    const r3 = await handleAgentMailWebhook(signed(body, secret, "msg_3"), deps);
    const s3 = await state();
    console.log("4. redelivery:", r3.status, JSON.stringify(await r3.json()), JSON.stringify(s3.tasks));
    if (r3.status !== 200 || s3.tasks.n !== s2.tasks.n) fail("redelivery must not create tasks");

    await sql`insert into calls (contact_id, provider_call_id, to_number, script, transcript) values (${contactId}::uuid, ${callId}, '+15555550100', 'synthetic', 'synthetic transcript')`;
    const ck = { kind: "call" as const, providerCallId: callId, contactId };
    const callClaims = await Promise.all([deps.ingestLedger.claim(ck), deps.ingestLedger.claim(ck)]);
    await deps.ingestLedger.complete(ck);
    const after = await deps.ingestLedger.claim(ck);
    console.log("5. call ledger:", JSON.stringify(callClaims), "after complete:", after);
    if (callClaims.filter(c => c === "claimed").length !== 1 || after !== "done") fail("call ledger claim/complete");
    verdict = "PASS";
  } finally {
    await sql`delete from cases where id = ${caseId}::uuid`;
    const [left] = (await sql`
      select (select count(*) from cases where id = ${caseId}::uuid)::int as cases,
             (select count(*) from contacts where id = ${contactId}::uuid)::int as contacts,
             (select count(*) from messages where contact_id = ${contactId}::uuid)::int as messages,
             (select count(*) from tasks where contact_id = ${contactId}::uuid)::int as tasks,
             (select count(*) from calls where contact_id = ${contactId}::uuid)::int as calls,
             (select count(*) from case_documents where case_id = ${caseId}::uuid)::int as documents`) as Record<string, number>[];
    console.log("leftover rows after cleanup:", JSON.stringify(left));
    if (Object.values(left).some(v => v !== 0)) console.error("CLEANUP INCOMPLETE");
    console.log(`RESULT: ${verdict}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
