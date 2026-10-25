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

const MIN_PASSWORD = 8;

export function ResetPasswordForm({ token, next }: { token?: string; next?: string }) {
  const destination = safeNext(next);
  const suffix = next ? `?next=${encodeURIComponent(destination)}` : "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthCard
        title="This link is not valid"
        lede="The reset link is missing its token. Request a new one and use the latest email."
        footer={
          <p className="m-0">
            <Link href={`/auth/forgot-password${suffix}`} className={AUTH_LINK}>
              Request a new link
            </Link>
          </p>
        }
      >
        <Callout tone="warn" role="status">Reset links expire, so older emails may no longer work.</Callout>
      </AuthCard>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || !token) return;
    const nextErrors: typeof errors = {};
    if (password.length < MIN_PASSWORD) nextErrors.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (confirm !== password) nextErrors.confirm = "The two passwords do not match.";
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) {
        setFormError(authErrorMessage(error, "reset-password"));
        setPending(false);
        return;
      }
      router.push(`/auth/sign-in${suffix}`);
    } catch (cause) {
      setFormError(authErrorMessage(cause, "reset-password"));
      setPending(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" lede="Pick something you have not used elsewhere.">
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <TextField
          id="reset-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          value={password}
          onValueChange={setPassword}
          error={errors.password}
          required
        />
        <TextField
          id="reset-confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onValueChange={setConfirm}
          error={errors.confirm}
          required
        />
        {formError ? <Callout tone="danger" role="alert">{formError}</Callout> : null}
        <Button type="submit" size="lg" loading={pending} loadingText="Saving" className="w-full text-body">
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
