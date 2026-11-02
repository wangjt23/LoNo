import { z } from 'zod';

export const summarySchema = z.object({
  overview: z.string().trim().min(2).max(280),
  keyPoints: z.array(z.string().trim().min(2).max(240)).min(1).max(6),
});

export const analysisSchema = z.object({
  shouldRemind: z.boolean(),
  title: z.string().trim().min(1).max(160),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  remindAt: z.string().datetime({ offset: true }).nullable(),
  priority: z.enum(['high', 'medium', 'low']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(800),
  summary: summarySchema.optional().catch(undefined),
});

export const taskInput = z.object({
  title: z.string().trim().min(1).max(160),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  remindAt: z.string().datetime({ offset: true }).nullable(),
  priority: z.enum(['high', 'medium', 'low']),
}).transform(f => ({ ...f, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null, remindAt: f.remindAt ? new Date(f.remindAt).toISOString() : null }));

export const memoryInput = z.object({
  kind: z.enum(['preference', 'person', 'workflow', 'fact']),
  content: z.string().trim().min(2).max(1000),
});
