import { z } from 'zod';

export const publicEventsQuerySchema = z.object({
  period: z.enum(['upcoming', 'past']).default('upcoming'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(10),
  year: z.coerce.number().int().min(1).max(9999).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
}).strict().refine((query) => query.month === undefined || query.year !== undefined, {
  message: 'Month requires year', path: ['month'],
});

export const discoveryEventsQuerySchema = z.object({
  near: z.string().regex(/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/).optional(),
  radius_km: z.coerce.number().finite().min(0).max(200).default(50),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const activitySchema = z.enum(['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other']);
const registrationChannelSchema = z.enum(['pre_only', 'on_night_only', 'both', 'external']);

const baseFields = {
  title: z.string().min(1).optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  time_zone: z.string().min(1).optional(),
  status: z.enum(['draft', 'published']).optional(),
  registrations_closed_at: z.string().datetime().nullable().optional(),
  capacity: z.number().min(1).optional(),
  // Location snapshot fields — must all be provided together or all omitted
  venue_name: z.string().min(1).optional(),
  address_line1: z.string().min(1).optional(),
  address_line2: z.string().optional(),
  postcode: z.string().optional(),
  city: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  city_id: z.string().uuid().nullable().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // Additional fields
  activities: z.array(activitySchema).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  entry_fee_amount: z.number().min(0).optional(),
  entry_fee_currency: z.string().optional(),
  entry_fee_note: z.string().optional(),
};

// Mirrors the DB CHECK constraints so invalid combinations fail fast with a
// 400 instead of surfacing as an opaque constraint-violation 500.
function refineCrossFieldRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const data = value as {
      ends_at?: string;
      starts_at?: string;
      entry_fee_amount?: number;
      entry_fee_currency?: string;
      lat?: number;
      lng?: number;
      venue_name?: string;
      address_line1?: string;
      address_line2?: string;
      postcode?: string;
      city?: string;
      country?: string;
      city_id?: string | null;
    };

    // Event time constraint: ends_at > starts_at if both provided
    if (data.ends_at && data.starts_at && data.ends_at <= data.starts_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_at'],
        message: 'ends_at must be after starts_at',
      });
    }

    // Lat/lng pairing: both present or both absent
    if ((data.lat === undefined) !== (data.lng === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lng'],
        message: 'lat and lng must be provided together',
      });
    }

    // Location snapshot atomicity: all location fields together or all omitted
    const locationFields = [data.venue_name, data.address_line1, data.city, data.country, data.lat, data.lng];
    const hasLocationField = locationFields.some((f) => f !== undefined);
    const allLocationFieldsPresent = locationFields.every((f) => f !== undefined);

    if ((hasLocationField || data.city_id != null) && !allLocationFieldsPresent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['venue_name'],
        message:
          'Location snapshot must provide all fields together (venue_name, address_line1, city, country, lat, lng) or none to inherit from parent open mic',
      });
    }

    // Entry fee constraint: amount > 0 requires currency
    if (typeof data.entry_fee_amount === 'number' && data.entry_fee_amount > 0 && !data.entry_fee_currency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entry_fee_currency'],
        message: 'entry_fee_currency is required when entry_fee_amount is greater than 0',
      });
    }
  });
}

export const createEventSchema = refineCrossFieldRules(
  z
    .object(baseFields)
    .required({
      title: true,
      starts_at: true,
      ends_at: true,
      time_zone: true,
    })
    .strict(),
);
export type CreateEventInput = z.infer<typeof createEventSchema>;

const { ...updatableFields } = baseFields;
export const updateEventSchema = refineCrossFieldRules(z.object(updatableFields).strict());
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
