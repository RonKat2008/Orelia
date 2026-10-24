"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { markClaimPending } from "../helpers/use-account";

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path fill="currentColor" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1a6.2 6.2 0 0 1 0-12.4c1.9 0 3.2.8 3.9 1.5l2.6-2.5A9.6 9.6 0 0 0 12 2.3a9.7 9.7 0 1 0 0 19.4c5.6 0 9.3-3.9 9.3-9.5 0-.6-.07-1.1-.16-2z" />
    </svg>
  );
}

export function GoogleButton({ callbackURL, onError }: { callbackURL: string; onError: (message: string) => void }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      size="lg"
      className="w-full text-body"
      loading={pending}
      loadingText="Opening Google"
      onClick={async () => {
        setPending(true);
        markClaimPending();
        try {
          const result = await authClient.signIn.social({ provider: "google", callbackURL });
          if (result?.error) {
            onError(result.error.message ?? "Google sign-in is not available right now.");
            setPending(false);
          }
        } catch {
          onError("Google sign-in is not available right now.");
          setPending(false);
        }
      }}
    >
      <GoogleMark />
      Continue with Google
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-4 text-small text-ink-3" role="separator" aria-label="or">
      <span aria-hidden className="h-px flex-1 bg-line" />
      or use email
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}
