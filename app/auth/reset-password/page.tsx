import type { Metadata } from "next";
import { AuthPage } from "@/components/account/auth/AuthCard";
import { ResetPasswordForm } from "@/components/account/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password", description: "Set a new Wayfinder password.", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <AuthPage>
      <ResetPasswordForm token={typeof token === "string" ? token : undefined} />
    </AuthPage>
  );
}
