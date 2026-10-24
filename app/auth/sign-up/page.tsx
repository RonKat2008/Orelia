import type { Metadata } from "next";
import { AuthPage } from "@/components/account/auth/AuthCard";
import { SignUpForm } from "@/components/account/auth/SignUpForm";

export const metadata: Metadata = { title: "Create account", description: "Create a Wayfinder account.", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <AuthPage>
      <SignUpForm next={typeof next === "string" ? next : undefined} />
    </AuthPage>
  );
}
