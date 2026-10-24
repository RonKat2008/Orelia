"use client";

import type { ProfilePrefill } from "./answers";

/**
 * Profile prefill for the patient intake.
 *
 * Intentional no-op: the accounts/profile feature has not landed, and calling a missing endpoint would log a
 * 404 in the console. When it lands, fetch the signed-in patient's profile here (for example GET /api/profile),
 * map it to ProfilePrefill, and return it (null while loading or when signed out). PatientIntake already applies
 * the result once with applyProfilePrefill, which only fills answers the patient has not given.
 */
export function useProfilePrefill(): ProfilePrefill | null {
  return null;
}
