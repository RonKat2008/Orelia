"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "./auth-error";
import { Callout, TextField } from "../FormBits";
import { safeNext } from "../helpers/safe-next";
import { AUTH_LINK, AuthCard } from "./AuthCard";

export function ForgotPasswordForm({ next }: { next?: string }) {
  const destination = safeNext(next);
  const suffix = next ? `?next=${encodeURIComponent(destination)}` : "";
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: authError } = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}/auth/reset-password${suffix}`,
      });
      if (authError) {
        setError(authErrorMessage(authError, "forgot-password"));
      } else {
        setSent(true);
      }
    } catch (cause) {
      setError(authErrorMessage(cause, "forgot-password"));
    }
    setPending(false);
  }

  return (
    <AuthCard
      title="Reset your password"
      lede="Enter your email and we will send a link to choose a new password."
      footer={
        <p className="m-0">
          <Link href={`/auth/sign-in${suffix}`} className={AUTH_LINK}>
            Back to sign in
          </Link>
        </p>
      }
    >
      {sent ? (
        <Callout tone="info" role="status">
          If an account exists for that email, a reset link is on its way. It can take a minute to arrive.
        </Callout>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <TextField
            id="forgot-email"
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onValueChange={setEmail}
            required
            autoFocus
          />
          {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
          <Button type="submit" size="lg" loading={pending} loadingText="Sending" className="w-full text-body">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
