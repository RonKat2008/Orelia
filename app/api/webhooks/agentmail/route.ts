import { handleAgentMailWebhook } from '../_lib/inbound';
import { postgresInboundDeps } from '../_lib/postgres';

export async function POST(req: Request) {
  return handleAgentMailWebhook(req, postgresInboundDeps('agentmail'));
}
