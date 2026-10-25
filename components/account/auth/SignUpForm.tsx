"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "./auth-error";
import { Callout, TextField } from "../FormBits";
import { safeNext } from "../helpers/safe-next";
import { AUTH_LINK, AuthCard } from "./AuthCard";
import { claimAnonymousCases } from "./finish-auth";
import { GoogleButton, OrDivider } from "./GoogleButton";

const MIN_PASSWORD = 8;

export function SignUpForm({ next }: { next?: string }) {
  const router = useRouter();
  const destination = safeNext(next);
  const suffix = next && destination !== "/account" ? `?next=${encodeURIComponent(destination)}` : "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = "Tell us what to call you.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = "Enter a valid email address.";
    if (password.length < MIN_PASSWORD) nextErrors.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    try {
      const { data, error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: destination });
      if (error) {
        setFormError(authErrorMessage(error, "sign-up"));
        setPending(false);
        return;
      }
      if (!data?.token) {
        setVerificationSent(true);
        setPending(false);
        return;
      }
      await claimAnonymousCases();
      router.push(destination);
      router.refresh();
    } catch (cause) {
      setFormError(authErrorMessage(cause, "sign-up"));
      setPending(false);
    }
  }

  if (verificationSent) {
    return (
      <AuthCard title="Check your email" lede="Your account was created. Follow the verification link in your email, then sign in to continue.">
        <Button asChild size="lg"><Link href={`/auth/sign-in${suffix}`}>Go to sign in</Link></Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      lede="Keep your medical documents and cases in one private place."
      footer={
        <p className="m-0">
          Already have an account?{" "}
          <Link href={`/auth/sign-in${suffix}`} className={AUTH_LINK}>
            Sign in
          </Link>
        </p>
      }
    >
      <GoogleButton callbackURL={destination} onError={setFormError} />
      <OrDivider />
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <TextField id="signup-name" label="Name" autoComplete="name" value={name} onValueChange={setName} error={errors.name} required autoFocus />
        <TextField
          id="signup-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onValueChange={setEmail}
          error={errors.email}
          required
        />
        <TextField
          id="signup-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          value={password}
          onValueChange={setPassword}
          error={errors.password}
          required
        />
        {formError ? <Callout tone="danger" role="alert">{formError}</Callout> : null}
        <Button type="submit" size="lg" loading={pending} loadingText="Creating account" className="w-full text-body">
          Create account
        </Button>
        <p className="m-0 text-small text-ink-2">Wayfinder is for adults, 18 and over.</p>
      </form>
    </AuthCard>
  );
}
