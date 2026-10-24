import { jsonError } from "@/app/api/cases/_lib/http";
import { NextResponse } from "next/server";
import { httpStatus } from "./actions";

export function demoJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function demoError(error: unknown) {
  const status = httpStatus(error);
  return jsonError(status, status === 404 ? "Not found" : "Demo request failed", error);
}
