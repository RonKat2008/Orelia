import type { Metadata } from "next";
import { AuthPage } from "@/components/account/auth/AuthPage";
import { ForgotPasswordForm } from "@/components/account/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password", description: "Request a password reset link.", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <AuthPage>
      <ForgotPasswordForm next={typeof next === "string" ? next : undefined} />
    </AuthPage>
  );
}
