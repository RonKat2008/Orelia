import { createResearchWorkflow } from '@/lib/workflows/research-workflow';
import { serve } from 'inngest/next';
import { createDefaultDeps } from '@/lib/workflows/default-deps';
import { createWorkflowFunctions, inngest } from '@/lib/workflows/inngest';

// A research agent phase can take up to 150s; allow its 180s deadline to settle.
export const maxDuration = 300;

const handlers = serve({
  client: inngest,
  functions: [...createWorkflowFunctions(createDefaultDeps()), createResearchWorkflow()],
});

// SDK registration may return provider exception text in a non-2xx body.
export const GET = handlers.GET;
export const POST = handlers.POST;
export async function PUT(...args: Parameters<typeof handlers.PUT>) {
  try {
    const response = await handlers.PUT(...args);
    if (response.ok) return response;
    console.error("[inngest] Registration failed", response.status, await response.text());
    return Response.json({ error: "Registration failed" }, { status: response.status });
  } catch (error) {
    console.error("[inngest] Registration failed", error);
    return Response.json({ error: "Registration failed" }, { status: 500 });
  }
}
