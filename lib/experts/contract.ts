/**
 * Research-to-care contract (FROZEN for the rd-experts lane; UI and backend both code against it).
 *
 * A chain answers, for one author of papers about the patient's disease (all their papers listed together):
 *   Paper -> author -> current institution -> does this person see patients? -> is there a professional
 *   e-consultation / second-opinion route? -> how to reach them.
 * Every conclusion (affiliation, sees-patients, consultation, contact route) cites code-stamped Evidence rows by id.
 * A verdict of 'unknown' is allowed with no evidence; 'yes' / 'no' always cite at least one row.
 * Describes access and documented activity only; never who is "best", never treatment advice.
 */
import { z } from 'zod';
import { evidenceSchema } from '../contracts/evidence';

export const chainVerdictSchema = z.enum(['yes', 'no', 'unknown']);
export type ChainVerdict = z.infer<typeof chainVerdictSchema>;

/** Claim types for evidence rows written by the tracer (prefix "experts."). */
export const EXPERT_CLAIM_TYPES = {
  authorship: 'experts.authorship',
  affiliation: 'experts.affiliation',
  institutionPage: 'experts.institution_page',
  seesPatients: 'experts.sees_patients',
  consultation: 'experts.consultation_program',
} as const;

const evidenceIds = z.array(z.string().min(1)).max(12);

const verdictNode = z.object({
  verdict: chainVerdictSchema,
  /** Plain-language sentence assembled by code from the cited evidence. */
  text: z.string().min(1).max(400),
  evidenceIds,
}).superRefine((n, ctx) => {
  if (n.verdict !== 'unknown' && n.evidenceIds.length === 0) ctx.addIssue({ code: 'custom', message: 'yes/no verdicts must cite evidence' });
});

export const reachRouteSchema = z.object({
  channel: z.enum(['email', 'voice', 'web_form', 'page']),
  /** e.g. "Second-opinion program page", "Practice phone listed in NPPES". */
  label: z.string().min(1).max(160),
  /** Display value (URL for web_form/page, phone or email otherwise). Comes from the cited row only. */
  address: z.string().min(1).max(2048),
  evidenceId: z.string().min(1),
});
export type ReachRoute = z.infer<typeof reachRouteSchema>;

export const chainPaperSchema = z.object({
  pmid: z.string().regex(/^\d+$/),
  title: z.string().min(1).max(500),
  journal: z.string().min(1).max(200).optional(),
  year: z.number().int().optional(),
  url: z.url(),
  evidenceId: z.string().min(1),
});
export type ChainPaper = z.infer<typeof chainPaperSchema>;

export const expertChainSchema = z.object({
  /** One chain per author identity (normalised name + institution): the author slug, suffixed when it repeats. */
  id: z.string().min(1),
  /** The author's newest paper in this chain (always also papers[0] on traces written since grouping). */
  paper: chainPaperSchema,
  /** Every paper of this author in the trace, newest first. Absent on traces saved before grouping: use chainPapers(). */
  papers: z.array(chainPaperSchema).min(1).max(8).optional(),
  author: z.object({
    name: z.string().min(1),
    /** Resource id of the matching expert record on this case, when one exists. */
    expertId: z.string().min(1).nullable(),
    npi: z.string().regex(/^\d{10}$/).nullable(),
    evidenceIds,
  }),
  institution: z.object({
    /** Institution name, from the paper affiliation / NPPES / institution page; null when none was found. */
    name: z.string().min(1).nullable(),
    pageUrl: z.url().nullable(),
    evidenceIds,
  }),
  seesPatients: verdictNode,
  consultation: verdictNode.and(z.object({ url: z.url().nullable() })),
  howToReach: z.array(reachRouteSchema).max(6),
});
export type ExpertChain = z.infer<typeof expertChainSchema>;

/** All papers of a chain, newest first (older saved traces carry only `paper`). */
export const chainPapers = (chain: ExpertChain): ChainPaper[] => (chain.papers?.length ? chain.papers : [chain.paper]);

/** Evidence row written by the tracer: id required, scoped to the resource it describes. */
export const traceEvidenceSchema = evidenceSchema.extend({
  id: z.string().min(1),
  targetKind: z.enum(['expert', 'institution']),
  targetId: z.string().min(1),
});
export type TraceEvidence = z.infer<typeof traceEvidenceSchema>;

export const expertTraceSchema = z.object({
  caseId: z.string().min(1),
  tracedAt: z.iso.datetime(),
  chains: z.array(expertChainSchema).max(30),
  evidence: z.array(traceEvidenceSchema),
});
export type ExpertTrace = z.infer<typeof expertTraceSchema>;

/**
 * HTTP (app/api/cases/[id]/experts/route.ts), ownership guard + same-origin + jsonError envelope like /plan:
 *   GET  -> 200 { trace: ExpertTrace | null }
 *   POST -> 201 { trace: ExpertTrace }   (runs the tracer for this case; never contacts anyone)
 */
export const expertsResponseSchema = z.object({ trace: expertTraceSchema.nullable() });
export type ExpertsResponse = z.infer<typeof expertsResponseSchema>;
