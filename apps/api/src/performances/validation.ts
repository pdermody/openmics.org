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

// Lifecycle: registered -> present (checked in at the door) -> scheduled (agreed to go next)
// -> performing (on stage) -> performed (finished their set). no_show/cancelled are manual
// overrides available from any state. A performer doing a second set gets a brand-new
// performance row (see registrations/routes.ts and the roster "perform again" action) rather
// than looping this row back to an earlier state.
export const performanceStatusSchema = z.enum(['registered', 'present', 'scheduled', 'performing', 'performed', 'no_show', 'cancelled']);

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
