/**
 * Event tracking and job tracing instrumentation (task a054cea4).
 *
 * Types and helpers for the structured event system.
 */

// ---------------------------------------------------------------------------
// Event categories
// ---------------------------------------------------------------------------

export type ProjectEvent =
  | 'project_created'
  | 'step_approved'
  | 'step_rejected'
  | 'step_started'
  | 'step_completed'
  | 'card_generation_requested';

export type GenerationEvent =
  | 'job_queued'
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'credit_consumed';

export type ExportEvent =
  | 'export_requested'
  | 'export_completed'
  | 'export_failed'
  | 'export_blocked_compliance';

export type EventType = ProjectEvent | GenerationEvent | ExportEvent;

export type EventCategory = 'project' | 'generation' | 'export';

// ---------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------

export interface BaseEvent {
  id: string;          // event id (uuid)
  timestamp: string;   // ISO timestamp
  category: EventCategory;
  type: EventType;
  projectId: string;
  userId?: string;
  stepId?: string;
  jobId?: string;
  cardId?: string;
  modelId?: string;
  resolution?: string;
  costEstimateCents?: number;
  /** Structured metadata specific to the event type */
  metadata?: Record<string, unknown>;
}

export interface ProjectEventData {
  planType?: string;
  marketplaces?: string[];
  stepType?: string;
  action?: string;
}

export interface GenerationEventData {
  provider?: string;
  promptLength?: number;
  numImages?: number;
  queueTimeMs?: number;
  processingTimeMs?: number;
  error?: string;
}

export interface ExportEventData {
  marketplaceTarget?: string;
  cardCount?: number;
  complianceScore?: number;
  format?: string;
  error?: string;
}

export type CardFlowEvent = BaseEvent & {
  data?: ProjectEventData | GenerationEventData | ExportEventData;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function categorizeEventType(type: EventType): EventCategory {
  const projectEvents: EventType[] = [
    'project_created',
    'step_approved',
    'step_rejected',
    'step_started',
    'step_completed',
    'card_generation_requested',
  ];

  const generationEvents: EventType[] = [
    'job_queued',
    'job_started',
    'job_completed',
    'job_failed',
    'credit_consumed',
  ];

  const exportEvents: EventType[] = [
    'export_requested',
    'export_completed',
    'export_failed',
    'export_blocked_compliance',
  ];

  if (projectEvents.includes(type)) return 'project';
  if (generationEvents.includes(type)) return 'generation';
  if (exportEvents.includes(type)) return 'export';
  return 'project';
}

function generateId(): string {
  const hex = () => Math.random().toString(16).substring(2, 10);
  return `${hex()}-${hex()}-${hex()}-${hex()}`.substring(0, 36);
}

/**
 * Create a project lifecycle event
 */
export function createProjectEvent(
  type: ProjectEvent,
  projectId: string,
  userId?: string,
  metadata?: Record<string, unknown>,
): CardFlowEvent {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    category: 'project',
    type,
    projectId,
    userId,
    metadata,
  };
}

/**
 * Create a generation/lifecycle event
 */
export function createGenerationEvent(
  type: GenerationEvent,
  projectId: string,
  jobId: string,
  options?: {
    userId?: string;
    cardId?: string;
    stepId?: string;
    modelId?: string;
    resolution?: string;
    costEstimateCents?: number;
    data?: Record<string, unknown>;
  },
): CardFlowEvent {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    category: 'generation',
    type,
    projectId,
    userId: options?.userId,
    stepId: options?.stepId,
    jobId,
    cardId: options?.cardId,
    modelId: options?.modelId,
    resolution: options?.resolution,
    costEstimateCents: options?.costEstimateCents,
    metadata: options?.data,
  };
}

/**
 * Create an export event
 */
export function createExportEvent(
  type: ExportEvent,
  projectId: string,
  options?: {
    userId?: string;
    jobId?: string;
    modelId?: string;
    costEstimateCents?: number;
    data?: Record<string, unknown>;
  },
): CardFlowEvent {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    category: 'export',
    type,
    projectId,
    userId: options?.userId,
    jobId: options?.jobId,
    modelId: options?.modelId,
    costEstimateCents: options?.costEstimateCents,
    metadata: options?.data,
  };
}
