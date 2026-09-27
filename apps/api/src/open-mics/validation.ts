import { z } from 'zod';

const activitySchema = z.enum(['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other']);
const registrationModeSchema = z.enum(['pre_only', 'on_night_only', 'both', 'external']);
const agePolicySchema = z.enum(['adults_only', 'children_only', 'both']);
const statusSchema = z.enum(['active', 'paused', 'ended', 'draft']);

const baseFields = {
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  handle: z.string().optional(),
  venue_name: z.string().min(1).optional(),
  address_line1: z.string().min(1).optional(),
  address_line2: z.string().optional(),
  postcode: z.string().optional(),
  city: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  time_zone: z.string().min(1).optional(),
  website: z.string().url().optional(),
  contact_email: z.string().email().optional(),
  schedule_summary: z.string().optional(),
  schedule_details: z.string().optional(),
  originals_only: z.boolean().optional(),
  amplification_available: z.boolean().optional(),
  age_policy: agePolicySchema.optional(),
  activities: z.array(activitySchema).min(1).optional(),
  tags: z.array(z.string()).optional(),
  registration_mode: registrationModeSchema.optional(),
  external_registration_url: z.string().url().optional(),
  entry_fee_amount: z.number().min(0).optional(),
  entry_fee_currency: z.string().optional(),
  entry_fee_note: z.string().optional(),
  status: statusSchema.optional(),
};

// Mirrors the DB CHECK constraints so invalid combinations fail fast with a
// 400 instead of surfacing as an opaque constraint-violation 500.
function refineCrossFieldRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const data = value as {
      registration_mode?: string;
      external_registration_url?: string;
      entry_fee_amount?: number;
      entry_fee_currency?: string;
      lat?: number;
      lng?: number;
    };
    if (data.registration_mode === 'external' && !data.external_registration_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['external_registration_url'],
        message: "external_registration_url is required when registration_mode is 'external'",
      });
    }
    if (typeof data.entry_fee_amount === 'number' && data.entry_fee_amount > 0 && !data.entry_fee_currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entry_fee_currency'],
        message: 'entry_fee_currency is required when entry_fee_amount is greater than 0',
      });
    }
    if ((data.lat === undefined) !== (data.lng === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lng'], message: 'lat and lng must be provided together' });
    }
  });
}

export const createOpenMicSchema = refineCrossFieldRules(
  z
    .object(baseFields)
    .required({
      name: true,
      venue_name: true,
      address_line1: true,
      city: true,
      country: true,
      time_zone: true,
      activities: true,
    })
    .strict(),
);
export type CreateOpenMicInput = z.infer<typeof createOpenMicSchema>;

// handle is omitted for the same reason as ProfileUpdateRequest: renaming has
// its own not-yet-implemented redirect/quarantine flow.
const { handle: _handle, ...updatableFields } = baseFields;
export const updateOpenMicSchema = refineCrossFieldRules(z.object(updatableFields).strict());
export type UpdateOpenMicInput = z.infer<typeof updateOpenMicSchema>;

export const kioskBackupPinSchema = z.object({ pin: z.string().min(4, 'PIN must be at least 4 characters') }).strict();
export type KioskBackupPinInput = z.infer<typeof kioskBackupPinSchema>;
