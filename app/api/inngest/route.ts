import { serve } from 'inngest/next';
import { createDefaultDeps } from '@/lib/workflows/default-deps';
import { createWorkflowFunctions, inngest } from '@/lib/workflows/inngest';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: createWorkflowFunctions(createDefaultDeps()),
});
