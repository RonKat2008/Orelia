"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "./auth-error";
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
      setError("Enter your email and password");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: authError } = await authClient.signIn.email({ email: email.trim(), password });
      if (authError) {
        setError(authErrorMessage(authError, "sign-in"));
        setPending(false);
        return;
      }
      await claimAnonymousCases();
      router.push(destination);
      router.refresh();
    } catch (cause) {
      setError(authErrorMessage(cause, "sign-in"));
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
          autoCapitalize="none"
          spellCheck={false}
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
        <p className="-mt-2 m-0 flex flex-wrap items-center gap-x-5 text-small">
          <Link href={`/auth/forgot-password${suffix}`} className={cn(AUTH_LINK, "inline-flex min-h-11 items-center")}>
            Forgot your password?
          </Link>
          {/* TODO(auth): offer "Email me a sign-in link" here once the auth backend enables the magic-link plugin. */}
        </p>
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        <Button type="submit" size="lg" loading={pending} loadingText="Signing in" className="w-full text-body">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
