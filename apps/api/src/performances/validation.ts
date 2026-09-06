import { z } from 'zod';

export const performanceActivitySchema = z.enum([
  'singing',
  'poetry',
  'jam',
  'trad',
  'comedy',
  'storytelling',
  'other',
]);

export const performanceStatusSchema = z.enum(['registered', 'performed', 'no_show', 'cancelled']);

export const createPerformanceSchema = z.object({
  registration_id: z.string().uuid(),
  name: z.string().min(1),
  activity: performanceActivitySchema.optional(),
  sequence: z.number().int().min(1).optional(),
  status: performanceStatusSchema.optional(),
  notes: z.string().nullable().optional(),
}).strict();
export type CreatePerformanceInput = z.infer<typeof createPerformanceSchema>;

export const updatePerformanceSchema = z.object({
  name: z.string().min(1).optional(),
  activity: performanceActivitySchema.nullable().optional(),
  sequence: z.number().int().min(1).optional(),
  status: performanceStatusSchema.optional(),
  notes: z.string().nullable().optional(),
}).strict();
export type UpdatePerformanceInput = z.infer<typeof updatePerformanceSchema>;
