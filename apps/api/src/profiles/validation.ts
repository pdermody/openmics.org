import { z } from 'zod';

export const profileKindSchema = z.enum(['organizer', 'performer']);
export const profileVisibilitySchema = z.enum(['public', 'unlisted', 'private']);

export const createProfileSchema = z.object({
  handle: z.string().optional(),
  profile_name: z.string().min(1),
  profile_kind: profileKindSchema,
  bio: z.string().optional(),
  visibility: profileVisibilitySchema.optional(),
  theme_name: z.string().optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;

// `handle` is intentionally omitted (not just optional): renaming is a
// separate, not-yet-implemented flow with its own redirect/quarantine policy.
// .strict() rejects the field outright rather than silently ignoring it.
export const updateProfileSchema = z
  .object({
    profile_name: z.string().min(1).optional(),
    profile_kind: profileKindSchema.optional(),
    bio: z.string().nullable().optional(),
    visibility: profileVisibilitySchema.optional(),
    theme_name: z.string().nullable().optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
