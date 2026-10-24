"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { Callout, TextField } from "../FormBits";
import { AUTH_LINK, AuthCard } from "./AuthCard";

export function ForgotPasswordForm() {
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
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (authError) {
        setError(authError.message ?? "We could not send the email. Please try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError("We could not reach the service. Please try again.");
    }
    setPending(false);
  }

  return (
    <AuthCard
      title="Reset your password"
      lede="Enter your email and we will send a link to choose a new password."
      footer={
        <p className="m-0">
          <Link href="/auth/sign-in" className={AUTH_LINK}>
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
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <TextField
            id="forgot-email"
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onValueChange={setEmail}
            required
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
