/**
 * Registers the engine-neutral workflow definitions with the real Inngest
 * client (inngest v4: triggers live in the function config).
 */
import { Inngest } from 'inngest';
import type { FunctionDefinition, WorkflowStep } from './engine';
import {
  createConnectionRestartWorkflow,
  createConnectionWorkflow,
  createFollowUpSendWorkflow,
  createStalledRevivalWorkflow,
  type ConnectionDeps,
} from './connection-workflow';

export const inngest = new Inngest({ id: 'wayfinder' });

export function toInngestFunction(def: FunctionDefinition) {
  return inngest.createFunction(
    {
      id: def.id,
      triggers: { event: def.trigger.event },
      ...(def.idempotency ? { idempotency: def.idempotency } : {}),
    },
    async ({ event, step }) =>
      def.handler({ event, step: step as unknown as WorkflowStep }),
  );
}

export function createWorkflowFunctions(deps: ConnectionDeps) {
  return [
    createConnectionWorkflow(deps),
    createFollowUpSendWorkflow(deps),
    createStalledRevivalWorkflow(deps),
    createConnectionRestartWorkflow(deps),
  ].map(toInngestFunction);
}
