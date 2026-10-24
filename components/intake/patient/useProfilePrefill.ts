"use client";

import { useMemo } from "react";
import { useIntakeProfile } from "../ProfilePrefill";
import type { ProfilePrefill } from "./answers";

/**
 * Profile prefill for the patient intake: the signed-in patient's saved profile (accounts feature), mapped to the
 * questions. Null while loading or when signed out. PatientIntake applies it once with applyProfilePrefill, which
 * only fills answers the patient has not given; nothing is shared until they tick it at consent.
 */
export function useProfilePrefill(): ProfilePrefill | null {
  const profile = useIntakeProfile();
  return useMemo(() => {
    if (!profile) return null;
    const prefill: ProfilePrefill = {
      ...(profile.primaryDiagnosis ? { condition: profile.primaryDiagnosis } : {}),
      ...(profile.city ? { city: profile.city } : {}),
      ...(profile.state ? { state: profile.state } : {}),
      ...(profile.insurer ? { insurer: profile.insurer } : {}),
      ...(typeof profile.travelLimitMiles === "number" ? { travelLimitMiles: profile.travelLimitMiles } : {}),
    };
    return Object.keys(prefill).length > 0 ? prefill : null;
  }, [profile]);
}
