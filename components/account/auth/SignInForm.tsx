"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { Callout, TextField } from "../FormBits";
import { safeNext } from "../helpers/safe-next";
import { AUTH_LINK, AuthCard } from "./AuthCard";
import { claimAnonymousCases } from "./finish-auth";
import { GoogleButton, OrDivider } from "./GoogleButton";

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const destination = safeNext(next);
  const suffix = next && destination !== "/account" ? `?next=${encodeURIComponent(destination)}` : "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: authError } = await authClient.signIn.email({ email: email.trim(), password });
      if (authError) {
        setError(authError.message ?? "We could not sign you in. Check your email and password.");
        setPending(false);
        return;
      }
      await claimAnonymousCases();
      router.push(destination);
      router.refresh();
    } catch {
      setError("We could not reach the sign-in service. Please try again.");
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      lede="Sign in to see your documents and cases."
      footer={
        <p className="m-0">
          New to Wayfinder?{" "}
          <Link href={`/auth/sign-up${suffix}`} className={AUTH_LINK}>
            Create an account
          </Link>
        </p>
      }
    >
      <GoogleButton callbackURL={destination} onError={setError} />
      <OrDivider />
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <TextField
          id="signin-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onValueChange={setEmail}
          required
        />
        <TextField
          id="signin-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onValueChange={setPassword}
          required
        />
        <div className="-mt-2 text-small">
          <Link href="/auth/forgot-password" className={AUTH_LINK}>
            Forgot your password?
          </Link>
        </div>
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        <Button type="submit" size="lg" loading={pending} loadingText="Signing in" className="w-full text-body">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
