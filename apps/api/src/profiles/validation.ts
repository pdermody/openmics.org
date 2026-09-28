import { z } from 'zod';

export const profileKindSchema = z.enum(['organizer', 'performer']);
export const profileVisibilitySchema = z.enum(['public', 'unlisted', 'private']);

export const createProfileSchema = z.object({
  handle: z.string().optional(),
  profile_name: z.string().min(1),
  profile_kind: profileKindSchema,
  bio: z.string().optional(),
  phone: z.string().trim().min(7).max(32).nullable().optional(),
  profile_image_url: z.string().url().nullable().optional(),
  visibility: profileVisibilitySchema.optional(),
  theme_name: z.string().optional(),
  color_mode: z.enum(['light', 'dark']).optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;

// `handle` and `profile_kind` are intentionally omitted (not just optional):
// renaming is a separate, not-yet-implemented flow, and kind is immutable.
// .strict() rejects the fields outright rather than silently ignoring them.
export const updateProfileSchema = z
  .object({
    profile_name: z.string().min(1).optional(),
    bio: z.string().nullable().optional(),
    phone: z.string().trim().min(7).max(32).nullable().optional(),
    profile_image_url: z.string().url().nullable().optional(),
    visibility: profileVisibilitySchema.optional(),
    theme_name: z.string().nullable().optional(),
    color_mode: z.enum(['light', 'dark']).nullable().optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
