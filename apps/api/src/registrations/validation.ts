import { z } from 'zod';

const submissionChannelSchema = z.enum([
  'organic',
  'shared_link',
  'email_reminder',
  'social_ad',
  'poster_qr',
  'kiosk',
  'kiosk_qr',
  'prior',
]);

const registrationFields = {
  profile_id: z.string().uuid().optional(),
  performer_name: z.string().min(1).optional(),
  performer_city: z.string().optional(),
  performer_city_id: z.string().uuid().nullable().optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().optional(),
  song_names: z.array(z.string()).optional(),
  bio: z.string().optional(),
  submission_channel: submissionChannelSchema.optional(),
  organizer_supervised: z.boolean().optional(),
  referred_by_profile_id: z.string().uuid().optional(),
  media_consent: z.boolean().optional(),
  reminders_opt_in: z.boolean().optional(),
};

export const createRegistrationSchema = z.object({ ...registrationFields, kiosk_token: z.string().min(1).optional() }).required({
  performer_name: true,
  submission_channel: true,
  organizer_supervised: true,
}).strict().superRefine((value, ctx) => {
  if (value.organizer_supervised && value.submission_channel !== 'kiosk') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['submission_channel'], message: 'Organizer-supervised registrations must use kiosk submission' });
  }
  if ((value.submission_channel === 'kiosk_qr') !== Boolean(value.kiosk_token)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kiosk_token'], message: 'kiosk_token is required for, and only allowed with, kiosk_qr submission' });
  }
  if (value.kiosk_token && value.organizer_supervised) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organizer_supervised'], message: 'Kiosk QR registrations are not organizer-supervised' });
  }
  if (!value.organizer_supervised && !value.kiosk_token && !value.profile_id && !value.contact_email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contact_email'], message: 'contact_email is required for guest registrations' });
  }
});
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;

export const updateRegistrationSchema = z.object({
  performer_name: z.string().min(1).optional(),
  performer_city: z.string().optional(),
  performer_city_id: z.string().uuid().nullable().optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().optional(),
  song_names: z.array(z.string()).optional(),
  bio: z.string().optional(),
  media_consent: z.boolean().optional(),
  reminders_opt_in: z.boolean().optional(),
  adopted_profile_id: z.string().uuid().nullable().optional(),
}).strict();
export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(1) }).strict();
export const claimRegistrationSchema = z.object({
  adopted_profile_id: z.string().uuid(),
  sync_public_fields: z.boolean().optional(),
  note: z.string().nullable().optional(),
}).strict();
