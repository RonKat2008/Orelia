import type { Metadata } from "next";
import { AuthPage } from "@/components/account/auth/AuthCard";
import { SignInForm } from "@/components/account/auth/SignInForm";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to your Wayfinder account.", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <AuthPage>
      <SignInForm next={typeof next === "string" ? next : undefined} />
    </AuthPage>
  );
}
