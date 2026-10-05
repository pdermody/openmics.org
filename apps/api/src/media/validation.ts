import { z } from 'zod';

const captionSchema = z.string().max(500);

const scopeFields = {
  event_id: z.string().uuid().optional(),
  open_mic_id: z.string().uuid().optional(),
  registration_id: z.string().uuid().optional(),
};

// Discriminated union on media_type (openapi.yaml → MediaCreateRequest): photo commits
// carry the server-generated object_key from /media/upload-url; video commits carry an
// allowlisted video_url. Exactly one of event_id/open_mic_id must resolve per commit —
// the scoped endpoints (/events/{id}/media, /open-mics/{id}/media) supply it via path.
export const createPhotoMediaSchema = z.object({
  media_type: z.literal('photo'),
  object_key: z.string().min(1),
  caption: captionSchema.optional(),
  ...scopeFields,
}).strict();

export const createVideoMediaSchema = z.object({
  media_type: z.literal('video'),
  video_url: z.string().url(),
  caption: captionSchema.optional(),
  ...scopeFields,
}).strict();

export const createMediaSchema = z.discriminatedUnion('media_type', [createPhotoMediaSchema, createVideoMediaSchema]);
export type CreateMediaInput = z.infer<typeof createMediaSchema>;

// media_type and the media source are immutable; .strict() rejects them outright.
export const updateMediaSchema = z.object({
  caption: captionSchema.nullable().optional(),
  registration_id: z.string().uuid().nullable().optional(),
}).strict();
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;

export const uploadUrlRequestSchema = z.object({
  media_type: z.enum(['photo', 'video']),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().positive().optional(),
}).strict();
export type UploadUrlRequestInput = z.infer<typeof uploadUrlRequestSchema>;

export const featuredMediaSchema = z.object({
  media_ids: z.array(z.string().uuid()).max(100),
}).strict();
export type FeaturedMediaInput = z.infer<typeof featuredMediaSchema>;

export const mediaListQuerySchema = z.object({
  type: z.enum(['all', 'photo', 'video']).default('all'),
  sort: z.enum(['newest', 'shuffle', 'most_liked']).default('newest'),
  seed: z.coerce.number().int().optional(),
  anchor: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  // Series galleries set this to keep Featured pins out of the masonry (they render in
  // the strip above it). Ignored by event/profile lists — featured is a series concept.
  exclude_featured: z.enum(['true', 'false']).optional(),
  public_view: z.enum(['true', 'false']).optional(),
});
export type MediaListQueryInput = z.infer<typeof mediaListQuerySchema>;

// The rendition Lambda's callback payload (signed with the shared secret; transported as
// text/plain so the API verifies the exact bytes that were signed).
export const renditionsCompleteSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  renditions: z.object({
    thumb: z.lazy(() => renditionSchema).optional(),
    grid: z.lazy(() => renditionSchema).optional(),
    lightbox: z.lazy(() => renditionSchema).optional(),
    original: z.lazy(() => renditionSchema).optional(),
  }),
});
const renditionSchema = z.object({
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
});
export type RenditionsCompleteInput = z.infer<typeof renditionsCompleteSchema>;
