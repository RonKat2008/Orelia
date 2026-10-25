import type { AnswerServiceDeps } from './answer-service';
import { DEMO_PATIENT_PROFILE, identityFromAccount } from './answers';
import { getApplicationStore } from './store';

/**
 * Route wiring for the answers service. Identity pre-fill comes from the account that owns the case (its profile,
 * plus the signed-in account's email when it is that same account), or, on a live demo case in demo mode only,
 * the synthetic demo patient. Failures fall back to no pre-fill; nothing is logged but the error name.
 */
export function defaultAnswerDeps(req: Request): AnswerServiceDeps {
  return {
    applications: getApplicationStore(),
    async identity(caseId) {
      try {
        const [{ liveDemoEnabled }, { isLiveDemoCase }] = await Promise.all([import('../demo-live/start'), import('../demo-live/skip-ahead')]);
        if (liveDemoEnabled(process.env) && await isLiveDemoCase(caseId)) return { profile: { ...DEMO_PATIENT_PROFILE }, origin: 'demo' };
      } catch (error) {
        console.error('[applications] demo check failed', error instanceof Error ? error.name : 'unknown');
      }
      try {
        const [{ caseAccountId }, { getAccountStore }, { currentAccount }] = await Promise.all([
          import('../accounts/case-link'), import('../accounts/store'), import('../accounts/current'),
        ]);
        const accountId = await caseAccountId(caseId);
        if (!accountId) return null;
        const [profile, account] = await Promise.all([getAccountStore().getProfile(accountId), currentAccount(req)]);
        const email = account?.id === accountId ? account.email : undefined;
        if (!profile && !email) return null;
        return { profile: identityFromAccount({ ...(profile ?? {}), email }), origin: 'profile' };
      } catch (error) {
        console.error('[applications] profile lookup failed', error instanceof Error ? error.name : 'unknown');
        return null;
      }
    },
  };
}
