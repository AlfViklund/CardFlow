import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const queueName = 'cardflow-jobs';
export const defaultCardCount = 8;
export const defaultStorageBucket = 'cardflow-dev';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const marketplaceSchema = z.enum(['wildberries', 'ozon']);

// Workflow step types in their canonical order
export const stepTypes = ['brief', 'text-plan', 'scenes', 'concept', 'final', 'revision', 'export'] as const;
export const stepTypeSchema = z.enum(stepTypes);

// Card statuses
export const cardStatusSchema = z.enum(['draft', 'step-active', 'approved', 'needs-revision', 'rejected']);

// Step statuses
export const stepStatusSchema = z.enum(['pending', 'in-progress', 'completed', 'needs-revision', 'skipped']);

// Approval actions
export const approvalActionSchema = z.enum(['approved', 'rejected', 'requested-changes']);

// Asset kind
export const assetKindSchema = z.enum(['source_image', 'reference_image', 'artifact', 'concept', 'final_card']);

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  brief: z.string().min(1).max(20_000).default(''),
  marketplaces: z.array(marketplaceSchema).min(1),
  defaultCardCount: z.number().int().positive().max(24).default(defaultCardCount),
  metadata: z.record(z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export const jobCreateSchema = z.object({
  projectId: z.string().uuid(),
  type: z.string().min(1).max(120),
  payload: z.record(z.unknown()).default({}),
  queueName: z.string().min(1).default(queueName),
});

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

export const assetCreateSchema = z.object({
  projectId: z.string().uuid(),
  kind: assetKindSchema,
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const cardCreateSchema = z.object({
  projectId: z.string().uuid(),
  cardNumber: z.number().int().min(1).max(200),
  title: z.string().max(500).default(''),
  promptInstructions: z.string().max(10_000).default(''),
  metadata: z.record(z.unknown()).default({}),
});

export const cardUpdateSchema = z.object({
  status: cardStatusSchema.optional(),
  title: z.string().max(500).optional(),
  promptInstructions: z.string().max(10_000).optional(),
  currentStep: stepTypeSchema.nullable().optional(),
  selectedConceptId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export const stepCreateSchema = z.object({
  cardId: z.string().uuid(),
  type: stepTypeSchema,
  result: z.record(z.unknown()).nullable().optional(),
  inheritedFromStepId: z.string().uuid().nullable().optional(),
});

export const stepUpdateSchema = z.object({
  status: stepStatusSchema.optional(),
  result: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  inheritedFromStepId: z.string().uuid().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export const approvalCreateSchema = z.object({
  stepId: z.string().uuid(),
  action: approvalActionSchema,
  comment: z.string().max(5000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

export const commentCreateSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  cardId: z.string().uuid().nullable().optional(),
  stepId: z.string().uuid().nullable().optional(),
  approvalId: z.string().uuid().nullable().optional(),
  author: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  metadata: z.record(z.unknown()).default({}),
}).refine(
  (data) => (
    data.projectId != null ||
    data.cardId != null ||
    data.stepId != null ||
    data.approvalId != null
  ),
  { message: 'at least one of projectId, cardId, stepId, or approvalId must be provided' },
);

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const workflowStepDefSchema = z.object({
  type: stepTypeSchema,
  position: z.number().int().min(0),
  requiresApproval: z.boolean().default(false),
  inheritFrom: z.string().nullable().optional(),  // previous step type to inherit from
  allowedRetries: z.number().int().min(0).default(1),
});

export const workflowDefinitionSchema = z.object({
  marketplace: marketplaceSchema,
  version: z.number().int().min(1).default(1),
  config: z.array(workflowStepDefSchema),
  active: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Types (TypeScript)
// ---------------------------------------------------------------------------

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type JobCreateInput = z.infer<typeof jobCreateSchema>;
export type AssetCreateInput = z.infer<typeof assetCreateSchema>;
export type CardCreateInput = z.infer<typeof cardCreateSchema>;
export type CardUpdateInput = z.infer<typeof cardUpdateSchema>;
export type StepCreateInput = z.infer<typeof stepCreateSchema>;
export type StepUpdateInput = z.infer<typeof stepUpdateSchema>;
export type ApprovalCreateInput = z.infer<typeof approvalCreateSchema>;
export type CommentCreateInput = z.infer<typeof commentCreateSchema>;
export type WorkflowStepDef = z.infer<typeof workflowStepDefSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type Step0IngestInput = z.infer<typeof step0IngestSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;

// ---------------------------------------------------------------------------
// Step 0 — Input ingestion & validation
// ---------------------------------------------------------------------------

/** Maximum reference images allowed */
export const MAX_REFERENCE_IMAGES = 5;
/** Maximum total images (main + additional + reference) */
export const MAX_TOTAL_IMAGES = 30;

/** Marketplace-specific upload validation */
export const marketplaceUploadRules = {
  wildberries: {
    minImageSize: 900,       // min pixels (width or height)
    maxImageSize: 10_000,    // max pixels
    maxFileSizeMb: 10,       // max file size in MB
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    requiredFields: ['mainImage', 'marketplaces'],
    maxAdditionalPhotos: 20,
  },
  ozon: {
    minImageSize: 400,       // min pixels
    maxImageSize: 8000,
    maxFileSizeMb: 15,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    requiredFields: ['mainImage', 'marketplaces'],
    maxAdditionalPhotos: 10,
  },
} as const;

export const imageInfoSchema = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string(),
  filename: z.string(),
});

export type ImageInfo = z.infer<typeof imageInfoSchema>;

export const qualityRiskSchema = z.object({
  code: z.enum([
    'low_resolution', 'oversized_file', 'unsupported_format',
    'aspect_ratio_extreme', 'missing_background_info', 'watermark_detected',
  ]),
  severity: z.enum(['warning', 'blocker']),
  detail: z.string(),
});

export type QualityRisk = z.infer<typeof qualityRiskSchema>;

export const inferredAttributeSchema = z.object({
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).default(0),
  source: z.enum(['filename', 'rule', 'ai_pending']),
});

export type InferredAttribute = z.infer<typeof inferredAttributeSchema>;

export const step0AnalysisSchema = z.object({
  mainImage: imageInfoSchema,
  additionalImages: z.array(imageInfoSchema).default([]),
  referenceImages: z.array(imageInfoSchema).default([]),
  brief: z.string().default(''),
  inferredCategory: inferredAttributeSchema.nullable().default(null),
  inferredAttributes: z.array(inferredAttributeSchema).default([]),
  qualityRisks: z.array(qualityRiskSchema).default([]),
  blockingReasons: z.array(z.string()).default([]),
  canProceed: z.boolean(),
});

export const validationRuleSchema = z.object({
  code: z.string(),
  marketplace: marketplaceSchema,
  field: z.string(),
  message: z.string(),
  is_blocking: z.boolean(),
});

export const validationResultSchema = z.object({
  canApprove: z.boolean(),
  rules: z.array(validationRuleSchema).default([]),
  blockingCodes: z.array(z.string()).default([]),
  warningCodes: z.array(z.string()).default([]),
});

// Input: what the user submits for Step 0
export const step0IngestSchema = z.object({
  projectId: z.string().uuid(),
  mainImage: z.object({
    filename: z.string().min(1).max(200),
    contentBase64: z.string().min(1),
  }),
  additionalImages: z.array(z.object({
    filename: z.string().min(1).max(200),
    contentBase64: z.string().min(1),
  })).max(20).default([]),
  referenceImages: z.array(z.object({
    filename: z.string().min(1).max(200),
    contentBase64: z.string().min(1),
  })).max(MAX_REFERENCE_IMAGES).default([]),
  brief: z.string().max(20_000).default(''),
});

export const step0AdditionalImageSchema = z.object({
  filename: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
});

export const step0AdditionalImagesUploadSchema = z.object({
  ingestionId: z.string().uuid(),
  images: z.array(step0AdditionalImageSchema).max(20),
});

export const step0ReferenceImageSchema = z.object({
  filename: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
});

export const step0ReferenceImagesUploadSchema = z.object({
  ingestionId: z.string().uuid(),
  images: z.array(step0ReferenceImageSchema).max(MAX_REFERENCE_IMAGES),
});

export const step0ApprovalSchema = z.object({
  ingestionId: z.string().uuid(),
  force: z.boolean().default(false),
});

export type Step0AdditionalImageInput = z.infer<typeof step0AdditionalImageSchema>;
export type Step0AdditionalImagesUploadInput = z.infer<typeof step0AdditionalImagesUploadSchema>;
export type Step0ReferenceImageInput = z.infer<typeof step0ReferenceImageSchema>;
export type Step0ReferenceImagesUploadInput = z.infer<typeof step0ReferenceImagesUploadSchema>;
export type Step0ApprovalInput = z.infer<typeof step0ApprovalSchema>;

// ---------------------------------------------------------------------------
// Helpers (continued)
// ---------------------------------------------------------------------------

export function getMergedRules(marketplaces: string[]): {
  minImageSize: number;
  maxImageSize: number;
  maxFileSizeMb: number;
  acceptedMimeTypes: readonly string[];
  requiredFields: readonly string[];
  maxAdditionalPhotos: number;
} {
  // When both are selected, use strictest rules
  const hasWb = marketplaces.includes('wildberries');
  const hasOzon = marketplaces.includes('ozon');
  if (hasWb && hasOzon) {
    // Strictest: lowest maxFileSizeMb, smallest minImageSize, lowest maxAdditionalPhotos
    return {
      minImageSize: Math.max(
        marketplaceUploadRules.wildberries.minImageSize,
        marketplaceUploadRules.ozon.minImageSize,
      ),
      maxImageSize: Math.min(
        marketplaceUploadRules.wildberries.maxImageSize,
        marketplaceUploadRules.ozon.maxImageSize,
      ),
      maxFileSizeMb: Math.min(
        marketplaceUploadRules.wildberries.maxFileSizeMb,
        marketplaceUploadRules.ozon.maxFileSizeMb,
      ),
      acceptedMimeTypes: marketplaceUploadRules.ozon.acceptedMimeTypes.filter(m =>
        marketplaceUploadRules.wildberries.acceptedMimeTypes.includes(m as typeof marketplaceUploadRules['wildberries']['acceptedMimeTypes'][number])
      ),
      requiredFields: [...new Set([
        ...marketplaceUploadRules.wildberries.requiredFields,
        ...marketplaceUploadRules.ozon.requiredFields,
      ])],
      maxAdditionalPhotos: Math.min(
        marketplaceUploadRules.wildberries.maxAdditionalPhotos,
        marketplaceUploadRules.ozon.maxAdditionalPhotos,
      ),
    };
  }
  if (hasWb) return marketplaceUploadRules.wildberries;
  return marketplaceUploadRules.ozon;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Canonical step order used for position calculation */
export function defaultWorkflowSteps(): WorkflowStepDef[] {
  return stepTypes.map((type, idx) => ({
    type,
    position: idx,
    requiresApproval: ['concept', 'final', 'export'].includes(type),
    allowedRetries: type === 'final' ? 3 : 1,
  }));
}

// ---------------------------------------------------------------------------
// Step Inheritance
// ---------------------------------------------------------------------------

export const stepInheritSchema = z.object({
  sourceStepId: z.string().uuid(),
  targetStepId: z.string().uuid(),
  inheritFields: z.array(z.string()).default(['result']),
});

export type StepInheritInput = z.infer<typeof stepInheritSchema>;

// ---------------------------------------------------------------------------
// Workflow Actions (task 38274b5f)
// ---------------------------------------------------------------------------

/** Target scope for regeneration */
export const regenScopeSchema = z.enum(['stage', 'card', 'element']);

/** Which element within a card to regenerate */
export const regenElementSchema = z.enum(['text', 'scene', 'design', 'background', 'position']);

export const regenerationRequestSchema = z.object({
  cardId: z.string().uuid(),
  stepId: z.string().uuid().optional(),  // null → regenerate at card/stage level
  scope: regenScopeSchema,
  element: regenElementSchema.nullable().optional(),
  reason: z.string().max(2000).optional(),
});

export type RegenerationRequestInput = z.infer<typeof regenerationRequestSchema>;

/** Step action payloads */
export const stepActionSchema = z.object({
  action: z.enum(['approve', 'request-changes', 'start']),
  comment: z.string().max(5000).optional(),
});

export type StepActionInput = z.infer<typeof stepActionSchema>;

/** Card-level workflow state summary */
export const cardWorkflowStateSchema = z.object({
  cardId: z.string().uuid(),
  status: cardStatusSchema,
  currentStepType: stepTypeSchema.nullable(),
  currentStepStatus: stepStatusSchema.nullable(),
  approvedSteps: z.array(stepTypeSchema),
  blockedSteps: z.array(z.object({
    type: stepTypeSchema,
    reason: z.string(),
  })),
  exportReady: z.boolean(),
  exportBlockers: z.array(z.string()).default([]),
});

export type CardWorkflowState = z.infer<typeof cardWorkflowStateSchema>;

/** Project-wide export readiness */
export const exportReadinessSchema = z.object({
  projectId: z.string().uuid(),
  ready: z.boolean(),
  totalCards: z.number().int(),
  readyCards: z.number().int(),
  cardDetails: z.array(z.object({
    cardNumber: z.number().int(),
    exportReady: z.boolean(),
    blockers: z.array(z.string()),
  })),
  reproducibility: z.object({
    seeds: z.record(z.string().nullable()).default({}),
    modelIds: z.record(z.string().nullable()).default({}),
    promptVersions: z.record(z.string().nullable()).default({}),
  }),
});

export type ExportReadiness = z.infer<typeof exportReadinessSchema>;

// ---------------------------------------------------------------------------
// Project Card Initialization
// ---------------------------------------------------------------------------

export const projectCardInitSchema = z.object({
  projectId: z.string().uuid(),
  cardCount: z.number().int().min(1).max(24).default(defaultCardCount),
  includeSteps: z.boolean().default(true),
});

export type ProjectCardInitInput = z.infer<typeof projectCardInitSchema>;

// ---------------------------------------------------------------------------
// Revision History
// ---------------------------------------------------------------------------

export const revisionQuerySchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().uuid(),
  branchName: z.string().min(1).max(100).default('main'),
  limit: z.number().int().min(1).max(100).default(50),
});

export type RevisionQueryInput = z.infer<typeof revisionQuerySchema>;

export const revisionReadSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  branchName: z.string(),
  version: z.number().int(),
  parentRevisionId: z.string().uuid().nullable(),
  assetId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  trace: z.record(z.unknown()),
  createdAt: z.string(),
});

export type RevisionRead = z.infer<typeof revisionReadSchema>;

// ---------------------------------------------------------------------------
// Marketplace Selection Update
// ---------------------------------------------------------------------------

export const marketplaceUpdateSchema = z.object({
  marketplaces: z.array(marketplaceSchema).min(1).max(2),
});

export type MarketplaceUpdateInput = z.infer<typeof marketplaceUpdateSchema>;

// ---------------------------------------------------------------------------
// Workflow State (aggregate)
// ---------------------------------------------------------------------------

export const workflowStepStateSchema = z.object({
  id: z.string().uuid(),
  type: stepTypeSchema,
  position: z.number().int(),
  status: stepStatusSchema,
  result: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  inheritedFromStepId: z.string().uuid().nullable(),
  approvals: z.array(z.object({
    id: z.string().uuid(),
    action: approvalActionSchema,
    comment: z.string().nullable(),
    reviewedAt: z.string(),
  })).default([]),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type WorkflowStepState = z.infer<typeof workflowStepStateSchema>;

export const workflowCardStateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  cardNumber: z.number().int(),
  status: cardStatusSchema,
  title: z.string(),
  promptInstructions: z.string(),
  currentStep: stepTypeSchema.nullable(),
  selectedConceptId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  steps: z.array(workflowStepStateSchema).default([]),
  comments: z.array(z.object({
    id: z.string().uuid(),
    author: z.string(),
    body: z.string(),
    createdAt: z.string(),
  })).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type WorkflowCardState = z.infer<typeof workflowCardStateSchema>;

export const workflowStateSchema = z.object({
  card: workflowCardStateSchema,
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    marketplaces: z.array(marketplaceSchema),
    defaultCardCount: z.number().int(),
  }),
});

export type WorkflowState = z.infer<typeof workflowStateSchema>;

// ---------------------------------------------------------------------------
// Default Card Count
// ---------------------------------------------------------------------------

export const defaultCardCountUpdateSchema = z.object({
  defaultCardCount: z.number().int().min(1).max(24),
});

export type DefaultCardCountUpdateInput = z.infer<typeof defaultCardCountUpdateSchema>;

// ---------------------------------------------------------------------------
// Step Inheritance Rules
// ---------------------------------------------------------------------------

/** Which fields are inheritable from a previous step of the same type */
export const inheritableFields = ['result'] as const;
export type InheritableField = typeof inheritableFields[number];

/** Map of step types that are allowed to inherit from a previous step type */
export const stepInheritanceRules: Record<string, string | null> = {
  'brief': null,
  'text-plan': 'brief',
  'scenes': 'text-plan',
  'concept': 'scenes',
  'final': 'concept',
  'revision': 'final',
  'export': 'final',
} as const;

/**
 * Determine if a step of the given type can inherit from a source step.
 * Returns the allowed source step type, or null if inheritance is not allowed.
 */
export function allowedInheritSource(targetType: string): string | null {
  return (stepInheritanceRules as Record<string, string | null>)[targetType] ?? null;
}

// ---------------------------------------------------------------------------
// Task 179ad31e — Staged async generation core
// ---------------------------------------------------------------------------

/** Generation stage types */
export const generationStageSchema = z.enum(['copy', 'scenes', 'design-concept', 'final']).describe(
  'Stages: copy (marketing text), scenes (product photography scenes), design-concept (visual layout), final (generated cards)',
);
export type GenerationStage = z.infer<typeof generationStageSchema>;

/** Generation scope — what level to target */
export const generationScopeSchema = z.enum(['card', 'batch', 'element']).describe(
  'card = single card, batch = all cards in project, element = specific element within a card',
);
export type GenerationScope = z.infer<typeof generationScopeSchema>;

/** Element type for targeted regeneration */
export const generationElementSchema = z.enum(['text', 'scene', 'design', 'background', 'position']);
export type GenerationElement = z.infer<typeof generationElementSchema>;

/** Generation status */
export const generationStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']);

/** AI provider abstraction */
export const aiProviderSchema = z.enum(['openai', 'stability', 'replicate', 'midjourney', 'custom']);
export type AIProvider = z.infer<typeof aiProviderSchema>;

/** Input for creating a generation job */
export const generationJobCreateSchema = z.object({
  projectId: z.string().uuid(),
  cardId: z.string().uuid().nullable().optional(),
  stage: generationStageSchema,
  scope: generationScopeSchema.default('card'),
  element: generationElementSchema.nullable().optional(),
  provider: aiProviderSchema.optional(),
  model: z.string().max(200).optional(),
  seed: z.number().int().nullable().optional(),
  prompt: z.string().max(50_000).optional(),
  inputData: z.record(z.unknown()).optional(),
  parentGenerationId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
});
export type GenerationJobCreateInput = z.infer<typeof generationJobCreateSchema>;

/** Output types */
export const generationOutputTypeSchema = z.enum(['text', 'scene', 'concept_image', 'final_card', 'batch_metadata']);
export type GenerationOutputType = z.infer<typeof generationOutputTypeSchema>;

/** Create generation output */
export const generationOutputCreateSchema = z.object({
  generationId: z.string().uuid(),
  cardId: z.string().uuid().nullable().optional(),
  outputType: generationOutputTypeSchema,
  content: z.record(z.unknown()).default({}),
  storageKey: z.string().max(500).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type GenerationOutputCreateInput = z.infer<typeof generationOutputCreateSchema>;

/** Reproducibility metadata for final series */
export const reproducibilitySchema = z.object({
  seed: z.number().int().nullable(),
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  referenceHashes: z.array(z.string()).default([]),
  approvedStepIds: z.array(z.string().uuid()).default([]),
});
export type ReproducibilityMetadata = z.infer<typeof reproducibilitySchema>;

/** Stage transition rules */
export const allowedStageTransitions: Record<string, string[]> = {
  'copy': ['scenes'],
  'scenes': ['design-concept'],
  'design-concept': ['final'],
  'final': [],
} as const;

/** Get allowed next stages for a given stage */
export function allowedNextStages(stage: string): string[] {
  return (allowedStageTransitions as Record<string, string[]>)[stage] ?? [];
}

/** Determine if a stage is "upstream" of another (must be approved first) */
export function isUpstreamOf(stage: string, targetStage: string): boolean {
  const order = ['copy', 'scenes', 'design-concept', 'final'];
  const stageIdx = order.indexOf(stage);
  const targetIdx = order.indexOf(targetStage);
  return stageIdx >= 0 && targetIdx >= 0 && stageIdx < targetIdx;
}

// ---------------------------------------------------------------------------
// Task 3f40bd18 — WB-first compliance engine & review gates
// ---------------------------------------------------------------------------

/** Compliance rule categories */
export const complianceCategorySchema = z.enum(['prohibited_content', 'visibility_quality', 'format_resolution']);
export type ComplianceCategory = z.infer<typeof complianceCategorySchema>;

/** Rule severity levels */
export const ruleSeveritySchema = z.enum(['critical', 'warning', 'info']);
export type RuleSeverity = z.infer<typeof ruleSeveritySchema>;

/** Compliance rule definition */
export const complianceRuleSchema = z.object({
  marketplace: marketplaceSchema,
  category: complianceCategorySchema,
  ruleCode: z.string().min(1).max(100),
  description: z.string().max(1000),
  severity: ruleSeveritySchema,
  metadata: z.record(z.unknown()).default({}),
});
export type ComplianceRuleInput = z.infer<typeof complianceRuleSchema>;

/** Single rule check result */
export const ruleCheckResultSchema = z.object({
  ruleCode: z.string(),
  passed: z.boolean(),
  severity: ruleSeveritySchema,
  detail: z.string().max(2000),
});
export type RuleCheckResult = z.infer<typeof ruleCheckResultSchema>;

/** Full compliance validation result */
export const complianceValidationSchema = z.object({
  projectId: z.string().uuid(),
  cardId: z.string().uuid().nullable().optional(),
  stepId: z.string().uuid().nullable().optional(),
  status: z.enum(['passed', 'failed', 'warning']),
  complianceScore: z.number().min(0).max(100),
  criticalFailures: z.number().int().min(0),
  warnings: z.number().int().min(0),
  ruleResults: z.array(ruleCheckResultSchema),
  report: z.string().max(10000).optional(),
});
export type ComplianceValidation = z.infer<typeof complianceValidationSchema>;

import {
  defaultWbRules,
  defaultOzonRules,
  getAllDefaultRules,
  ComplianceValidator,
  buildComplianceReport,
  getMessageForRule,
  validateCardCount,
} from './compliance';
export type { ComplianceInput, ComplianceReport } from './compliance';
export {
  defaultWbRules,
  defaultOzonRules,
  getAllDefaultRules,
  ComplianceValidator,
  buildComplianceReport,
  getMessageForRule,
  validateCardCount,
};

/** Calculate compliance score from rule results */
export function calculateComplianceScore(ruleResults: RuleCheckResult[]): { score: number; criticalFailures: number; warnings: number } {
  let score = 100;
  let criticalFailures = 0;
  let warnings = 0;
  
  for (const result of ruleResults) {
    if (!result.passed) {
      switch (result.severity) {
        case 'critical':
          criticalFailures++;
          score -= 30;
          break;
        case 'warning':
          warnings++;
          score -= 10;
          break;
        case 'info':
          score -= 3;
          break;
      }
    }
  }
  
  return { score: Math.max(0, Math.min(100, score)), criticalFailures, warnings };
}

/** Get merged (strictest) rules for a project's marketplace selection */
export function getMergedComplianceRules(marketplaces: string[]): ComplianceRuleInput[] {
  const allRules = getAllDefaultRules();
  if (marketplaces.length === 1) {
    return allRules.filter((r) => r.marketplace === marketplaces[0]);
  }
  // For both marketplaces, use all rules (strictest applies)
  return allRules;
}

/** Check if export is blocked based on compliance results */
export function isExportBlocked(criticalFailures: number): boolean {
  return criticalFailures > 0;
}


// ---------------------------------------------------------------------------
// Task 37533c09 — Batch generation + recoverable export
// ---------------------------------------------------------------------------

export {
  createBatchMetadata,
  isWithinBudget,
  generateCardProviderConfig,
  canProceedWithBatch,
  buildExportFileList,
  buildExportManifest,
  buildCsvManifest,
  generateExportStorageKey,
  canRecoverExport,
} from './batch';

export type {
  BatchGenerationInput,
  BatchProgress,
  ExportPackageManifest,
  OverlayConfig,
} from './batch';

// ---------------------------------------------------------------------------
// Task ca05a06d — Quality-risk scoring + Step 0 gating
// ---------------------------------------------------------------------------

export {
  analyzeQuality,
  scoreSharpness,
  scoreResolution,
  scoreLighting,
  scoreBackground,
  scoreProductVisibility,
  makeGatingDecision,
  generateQualityReport,
  DIMENSION_WEIGHTS,
} from './quality';

export type {
  QualityAnalysisInput,
  QualityAnalysisResult,
  QualityDimensionScore,
  QualityRiskEntry,
  QualityScoreDimension,
  GatingResult,
} from './quality';

// ---------------------------------------------------------------------------
// Task 2ecad978 — Compliance gating for export
// ---------------------------------------------------------------------------

export {
  validateExportCard,
  validateProjectForExport,
  type CardValidationInput,
  type CardValidationResult,
  type ExportValidationResult,
} from './export-gating';

// ---------------------------------------------------------------------------
// Task 56cc7032 — Cost controls and rate-limiting
// ---------------------------------------------------------------------------

export {
  calculateTotalCost,
  costsByProvider,
  costsByCard,
  predictBatchCost,
  isRateLimited,
  checkBudget,
  generateBatchCostReport,
  DEFAULT_BUDGET_CONFIG,
  type CostEntry,
  type BudgetConfig,
  type UsageSnapshot,
  type RateLimitEntry,
} from './cost-controls';
