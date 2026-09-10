import { z } from 'zod';

// .strict() rejects unknown fields outright (e.g. email, plan, is_platform_admin) rather than
// silently ignoring them — those are not user-editable via this endpoint.
export const updateAccountSchema = z
  .object({
    display_name: z.string().min(1).nullable().optional(),
    city: z.string().nullable().optional(),
    preferred_language: z.string().nullable().optional(),
  })
  .strict();

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
