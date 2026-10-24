import { NextResponse } from "next/server";
import { httpStatus } from "./actions";

export function demoJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function demoError(error: unknown) {
  const status = httpStatus(error);
  const message = error instanceof Error ? error.message : "Demo request failed";
  return NextResponse.json({ error: status === 404 ? "Not found" : message }, { status });
}
