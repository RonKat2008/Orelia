import type { Account } from "./contract";
import { accountsEnabled, getNeonAuth } from "@/lib/auth/neon";

/** Resolves the signed-in account for a request. The default reads the Neon Auth session cookie. */
export interface AccountResolver {
  resolve(req: Request): Promise<Account | null>;
}

export const neonAccountResolver: AccountResolver = {
  async resolve() {
    if (!accountsEnabled()) return null;
    try {
      const auth = await getNeonAuth();
      const { data } = await auth.getSession();
      const user = data?.user;
      if (!user?.id) return null;
      return { id: String(user.id), email: String(user.email ?? ""), name: user.name ? String(user.name) : null };
    } catch (err) {
      console.error("[accounts] session lookup failed", err instanceof Error ? err.name : "error");
      return null;
    }
  },
};

/** Test resolver: `x-test-account: <id>` header (only installed by tests). */
export class HeaderAccountResolver implements AccountResolver {
  async resolve(req: Request): Promise<Account | null> {
    const id = req.headers.get("x-test-account");
    return id ? { id, email: `${id}@example.test`, name: id } : null;
  }
}

const g = globalThis as { __wayfinderAccountResolver?: AccountResolver };
export function getAccountResolver(): AccountResolver {
  return g.__wayfinderAccountResolver ?? neonAccountResolver;
}
export function setAccountResolverForTests(resolver: AccountResolver | undefined): void {
  if (resolver) g.__wayfinderAccountResolver = resolver;
  else delete g.__wayfinderAccountResolver;
}
export function currentAccount(req: Request): Promise<Account | null> {
  return getAccountResolver().resolve(req);
}
