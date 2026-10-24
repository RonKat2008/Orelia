import { getWebFormChannel } from '../plan/channels';
import type { ApproveApplicationDeps } from './approve';
import { getApplicationStore } from './store';

/** Route wiring: application store, Postgres consent/case/contacts, and the plan's web-form port for submission. */
export function defaultApproveDeps(): ApproveApplicationDeps {
  const outreach = async () => {
    const { PostgresOutreachStore } = await import('../outreach/postgres-store');
    return new PostgresOutreachStore();
  };
  const hasDb = () => !!process.env.DATABASE_URL;
  return {
    applications: getApplicationStore(),
    outreach: {
      async getCase(caseId) { return hasDb() ? (await outreach()).getCase(caseId) : undefined; },
      async consent(contactId) { return hasDb() ? (await outreach()).consent(contactId) : undefined; },
      async contacts(caseId) { return hasDb() ? (await outreach()).contacts(caseId) : []; },
    },
    async submit(gated) {
      const res = await getWebFormChannel().submitGated(gated);
      if (!res.ok) throw new Error('web form channel unavailable');
    },
  };
}
