import { createResearchWorkflow } from '@/lib/workflows/research-workflow';
import { serve } from 'inngest/next';
import { createDefaultDeps } from '@/lib/workflows/default-deps';
import { createWorkflowFunctions, inngest } from '@/lib/workflows/inngest';

// A research agent phase can take up to 150s; allow its 180s deadline to settle.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...createWorkflowFunctions(createDefaultDeps()), createResearchWorkflow()],
});
