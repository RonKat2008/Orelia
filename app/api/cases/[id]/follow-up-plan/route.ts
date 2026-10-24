import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody, parseId } from "../../_lib/http";
import { getFollowUpPlan } from "@/lib/outreach/follow-up-plan";
import type { CaseSnapshot } from "@/lib/outreach/preapprove";
import { allowlistFrom, notifyMode } from "@/lib/notify";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

const snapshotSchema = z.object({
  diseaseName: z.string().min(1),
  diseaseCodes: z.unknown().nullable().optional(),
  subtype: z.string().nullable().optional(),
  stageSummary: z.string().nullable().optional(),
  homeCity: z.string().nullable().optional(),
  homeState: z.string().nullable().optional(),
  insurer: z.string().nullable().optional(),
  planId: z.string().nullable().optional(),
  travelLimitMiles: z.number().int().nullable().optional(),
  goals: z.array(z.string()).default([]),
});

const putSchema = z.object({
  contactId: z.uuid().optional(),
  action: z.enum(["approve", "revoke"]).optional(),
  channel: z.enum(["email", "voice"]).optional(),
  contactState: z.string().optional(),
  sharedFields: z.array(z.string()).optional(),
  consentApprovedAt: z.string().nullable().optional(),
  snapshot: snapshotSchema.optional(),
  notification: z.object({
    patientEmail: z.string().nullable().optional(),
    optIn: z.boolean(),
  }).optional(),
});

function policy() {
  const source = process.env;
  return {
    mode: notifyMode({ WAYFINDER_DEMO: source.WAYFINDER_DEMO, NODE_ENV: source.NODE_ENV }),
    allowlist: allowlistFrom(source.OUTBOUND_ALLOWLIST),
    outboundAllowReal: source.OUTBOUND_ALLOW_REAL,
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  try {
    const plan = await getFollowUpPlan().list(id);
    return NextResponse.json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load follow-up plan";
    return jsonError(message === "Case not found" ? 404 : 500, message);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const store = getFollowUpPlan();
  try {
    if (body.data.notification) {
      await store.saveNotification(id, {
        patientEmail: body.data.notification.patientEmail ?? null,
        optIn: body.data.notification.optIn,
      }, policy());
    }
    if (body.data.action === "revoke") {
      if (!body.data.contactId) return jsonError(400, "contactId is required to revoke");
      const revoked = await store.revoke(body.data.contactId);
      return NextResponse.json({ ...await store.list(id), ...revoked });
    }
    if (body.data.action === "approve") {
      if (!body.data.contactId || !body.data.channel || !body.data.snapshot || !body.data.consentApprovedAt) {
        return jsonError(400, "approve requires contactId, channel, snapshot, and consentApprovedAt");
      }
      const snapshot: CaseSnapshot = {
        diseaseName: body.data.snapshot.diseaseName,
        diseaseCodes: body.data.snapshot.diseaseCodes ?? null,
        subtype: body.data.snapshot.subtype ?? null,
        stageSummary: body.data.snapshot.stageSummary ?? null,
        homeCity: body.data.snapshot.homeCity ?? null,
        homeState: body.data.snapshot.homeState ?? null,
        insurer: body.data.snapshot.insurer ?? null,
        planId: body.data.snapshot.planId ?? null,
        travelLimitMiles: body.data.snapshot.travelLimitMiles ?? null,
        goals: body.data.snapshot.goals,
      };
      await store.approve({
        contactId: body.data.contactId,
        caseId: id,
        channel: body.data.channel,
        contactState: body.data.contactState ?? "sent",
        sharedFields: body.data.sharedFields ?? [],
        consentApprovedAt: body.data.consentApprovedAt,
        snapshot,
        approvedAt: new Date(),
      });
    }
    return NextResponse.json(await store.list(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update follow-up plan";
    const status = message.includes("ALLOWLIST") || message.includes("Invalid") || message.includes("Consent") ? 400 : 500;
    return jsonError(status, message);
  }
}
