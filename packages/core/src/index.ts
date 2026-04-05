import { z } from 'zod';

export const queueName = 'cardflow-jobs';
export const defaultCardCount = 8;
export const defaultStorageBucket = 'cardflow-dev';

export const marketplaceSchema = z.enum(['wildberries', 'ozon']);

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  brief: z.string().min(1).max(20_000).default(''),
  marketplaces: z.array(marketplaceSchema).min(1),
  defaultCardCount: z.number().int().positive().max(24).default(defaultCardCount),
  metadata: z.record(z.unknown()).default({}),
});

export const jobCreateSchema = z.object({
  projectId: z.string().uuid(),
  type: z.string().min(1).max(120),
  payload: z.record(z.unknown()).default({}),
  queueName: z.string().min(1).default(queueName),
});

export const assetCreateSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(['source_image', 'reference_image', 'artifact']),
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type JobCreateInput = z.infer<typeof jobCreateSchema>;
export type AssetCreateInput = z.infer<typeof assetCreateSchema>;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
