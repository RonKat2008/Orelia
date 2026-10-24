import { handleAgentCallWebhook } from '../_lib/inbound';
import { postgresInboundDeps } from '../_lib/postgres';

export async function POST(req: Request) {
  return handleAgentCallWebhook(req, postgresInboundDeps('agentcall'));
}
