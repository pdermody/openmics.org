import { z } from 'zod';

const languageTagSchema = z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, 'preferred_language must be a BCP 47 language tag');

// .strict() rejects unknown fields outright (e.g. email, plan, is_platform_admin) rather than
// silently ignoring them — those are not user-editable via this endpoint.
export const updateAccountSchema = z
  .object({
    display_name: z.string().min(1).nullable().optional(),
    city: z.string().nullable().optional(),
    city_id: z.string().uuid().nullable().optional(),
    preferred_language: languageTagSchema.nullable().optional(),
  })
  .strict();

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
