import { apiRequest } from "../helpers/api";

/** After sign-in/up: attach this browser's anonymous cases to the account. Failure never blocks the person. */
export async function claimAnonymousCases(): Promise<void> {
  await apiRequest("/api/account/claim", { method: "POST" });
}
