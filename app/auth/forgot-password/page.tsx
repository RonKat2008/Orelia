import type { Metadata } from "next";
import { AuthPage } from "@/components/account/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/account/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password", description: "Request a password reset link.", robots: { index: false } };

export default function Page() {
  return (
    <AuthPage>
      <ForgotPasswordForm />
    </AuthPage>
  );
}
