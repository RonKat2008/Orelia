/**
 * Verifies the follow-up sweep's atomic claim against the REAL Postgres named by DATABASE_URL.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/verify-follow-up-claim.ts
 *
 * Creates one synthetic case + one due contact (address = first DEMO_COORDINATOR_INBOXES entry), runs two sweeps
 * concurrently with the real PostgresFollowUpSweepStore and durable deps (send is a counting stub that throws,
 * so nothing can be emailed), asserts exactly one claim and one follow-up draft, then deletes the case (cascade)
 * and verifies zero leftover rows. Refuses to run if any other contact is due, since the sweep is global.
 */
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { PostgresContactContextStore } from "../lib/workflows/contact-store";
import { createDurableDeps } from "../lib/workflows/default-deps";
import { PostgresFollowUpSweepStore, runFollowUpSweep, type SweepResult } from "../lib/workflows/follow-up-sweep";

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(msg: string): never {
  throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (source .env.local first)");
  const address = (process.env.DEMO_COORDINATOR_INBOXES ?? "").split(",").map((a) => a.trim()).find((a) => a.includes("@"));
  if (!address) throw new Error("DEMO_COORDINATOR_INBOXES has no email address");
  const sql = neon(url);

  const [{ n: otherDue }] = (await sql`
    select count(*)::int as n from contacts
    where state = 'sent' and next_follow_up_at is not null and next_follow_up_at <= now()`) as { n: number }[];
  if (otherDue > 0) throw new Error(`${otherDue} other due contact(s) exist; sweep is global, refusing to run`);

  const caseId = randomUUID();
  const contactId = randomUUID();
  const now = Date.now();
  let verdict = "NOT RUN";
  try {
    await sql`insert into cases (id, disease_name, status) values (${caseId}::uuid, 'ZZ follow-up claim verification (synthetic)', 'unconfirmed')`;
    await sql`insert into contacts (id, case_id, target_kind, target_id, channel, address, state, first_sent_at, next_follow_up_at, last_activity_at, follow_ups_sent)
      values (${contactId}::uuid, ${caseId}::uuid, 'organization', ${randomUUID()}::uuid, 'email', ${address}, 'sent',
        ${new Date(now - 6 * DAY_MS).toISOString()}::timestamptz, ${new Date(now - 60_000).toISOString()}::timestamptz,
        ${new Date(now - 6 * DAY_MS).toISOString()}::timestamptz, 0)`;
    await sql`insert into messages (contact_id, direction, channel, subject, body, approved_at, sent_at, classification, provider_message_id)
      values (${contactId}::uuid, 'outbound', 'email', 'ZZ synthetic intro', 'synthetic first message', ${new Date(now - 6 * DAY_MS).toISOString()}::timestamptz,
        ${new Date(now - 6 * DAY_MS).toISOString()}::timestamptz, 'initial', 'synthetic-provider-id')`;

    let sendCalls = 0;
    const makeDeps = () =>
      createDurableDeps({
        store: new PostgresContactContextStore(),
        env: { ...process.env, WAYFINDER_SIM_TIME_SCALE: "1" },
        async send() {
          sendCalls += 1;
          throw new Error("send stub: outbound disabled in verification");
        },
      });

    const results: SweepResult[] = await Promise.all([
      runFollowUpSweep({ store: new PostgresFollowUpSweepStore(), deps: makeDeps() }),
      runFollowUpSweep({ store: new PostgresFollowUpSweepStore(), deps: makeDeps() }),
    ]);
    const claimed = results.reduce((a, r) => a + r.claimed, 0);
    const processed = results.reduce((a, r) => a + r.processed, 0);
    const failed = results.reduce((a, r) => a + r.failed, 0);
    const drafts = (await sql`select count(*)::int as n from messages where contact_id = ${contactId}::uuid and classification = 'follow_up_1' and sent_at is null`) as { n: number }[];
    const [after] = (await sql`select state, follow_ups_sent, next_follow_up_at > now() as future from contacts where id = ${contactId}::uuid`) as {
      state: string; follow_ups_sent: number; future: boolean;
    }[];
    console.log("sweep results:", JSON.stringify(results));
    console.log(`total claimed=${claimed} processed=${processed} failed=${failed} follow_up_1 drafts=${drafts[0].n} send calls=${sendCalls}`);
    console.log("contact after:", JSON.stringify(after));

    if (claimed !== 1) fail(`expected exactly 1 claim across both sweeps, got ${claimed}`);
    if (processed !== 1 || failed !== 0) fail(`expected 1 processed / 0 failed, got ${processed}/${failed}`);
    if (drafts[0].n !== 1) fail(`expected exactly 1 follow-up draft, got ${drafts[0].n}`);
    if (sendCalls !== 0) fail(`send stub was called ${sendCalls} time(s); expected 0 (unapproved draft path)`);
    if (!after?.future) fail("next_follow_up_at was not pushed to a future deadline after processing");
    verdict = "PASS";
  } finally {
    await sql`delete from cases where id = ${caseId}::uuid`;
    const [left] = (await sql`
      select (select count(*) from cases where id = ${caseId}::uuid)::int as cases,
             (select count(*) from contacts where id = ${contactId}::uuid or case_id = ${caseId}::uuid)::int as contacts,
             (select count(*) from messages where contact_id = ${contactId}::uuid)::int as messages,
             (select count(*) from consents where contact_id = ${contactId}::uuid)::int as consents`) as Record<string, number>[];
    console.log("leftover rows after cleanup:", JSON.stringify(left));
    if (Object.values(left).some((v) => v !== 0)) console.error("CLEANUP INCOMPLETE");
    console.log(`RESULT: ${verdict}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
