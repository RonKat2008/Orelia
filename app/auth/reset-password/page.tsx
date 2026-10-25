import type { Metadata } from "next";
import { AuthPage } from "@/components/account/auth/AuthPage";
import { ResetPasswordForm } from "@/components/account/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password", description: "Set a new Orelia password.", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[]; next?: string | string[] }> }) {
  const { token, next } = await searchParams;
  return (
    <AuthPage>
      <ResetPasswordForm token={typeof token === "string" ? token : undefined} next={typeof next === "string" ? next : undefined} />
    </AuthPage>
  );
}
