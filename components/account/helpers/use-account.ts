"use client";

import { useEffect, useState } from "react";
import type { Account } from "@/lib/accounts/contract";
import { apiRequest } from "./api";

export type AccountState =
  | { status: "loading"; enabled: false; account: null }
  | { status: "ready"; enabled: boolean; account: Account | null };

interface AccountResponse {
  enabled: boolean;
  account: Account | null;
}

let inflight: Promise<AccountState> | null = null;

/** De-duplicates simultaneous GET /api/account calls (header menu + page body). Not cached after it settles. */
function loadAccount(): Promise<AccountState> {
  if (!inflight) {
    inflight = apiRequest<AccountResponse>("/api/account")
      .then((res): AccountState => ({
        status: "ready",
        enabled: res.ok ? Boolean(res.data?.enabled) : false,
        account: res.ok ? (res.data?.account ?? null) : null,
      }))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useAccount(): AccountState {
  const [state, setState] = useState<AccountState>({ status: "loading", enabled: false, account: null });
  useEffect(() => {
    let live = true;
    void loadAccount().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

const CLAIM_FLAG = "wf-claim-pending";

/** Remember that an OAuth redirect is about to happen, so the next page can claim anonymous cases. */
export function markClaimPending(): void {
  try {
    window.sessionStorage.setItem(CLAIM_FLAG, "1");
  } catch {
    // Storage unavailable: the claim simply does not run after Google sign-in.
  }
}

/** If a claim is pending (set before an OAuth redirect), run it once now that the person is signed in. */
export async function claimIfPending(): Promise<void> {
  try {
    if (window.sessionStorage.getItem(CLAIM_FLAG) !== "1") return;
    window.sessionStorage.removeItem(CLAIM_FLAG);
  } catch {
    return;
  }
  await apiRequest("/api/account/claim", { method: "POST" });
}
