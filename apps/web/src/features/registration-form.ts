import { z } from 'zod'

export const registrationFormSchema = z.object({
  performer_name: z.string().trim(),
  performer_city: z.string().trim(),
  performer_city_id: z.string().nullable(),
  contact_email: z.union([z.literal(''), z.string().trim().email()]),
  contact_phone: z.string().trim(),
  song_names: z.string(),
  media_consent: z.boolean(),
})

export type RegistrationFormValues = z.infer<typeof registrationFormSchema>

export const kioskFormSchema = registrationFormSchema.extend({
  performer_name: z.string().trim().min(1),
  bio: z.string().trim(),
  reminders_opt_in: z.boolean(),
})
export type KioskFormValues = z.infer<typeof kioskFormSchema>
