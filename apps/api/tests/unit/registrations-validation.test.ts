import { describe, expect, it } from 'vitest';

import { claimRegistrationSchema, createRegistrationSchema, updateRegistrationSchema } from '../../src/registrations/validation.js';

const guest = {
  performer_name: 'Guest Performer',
  contact_email: 'guest@example.test',
  submission_channel: 'organic' as const,
  organizer_supervised: false,
};

describe('registration validation', () => {
  it('accepts a minimal guest registration', () => {
    expect(createRegistrationSchema.safeParse(guest).success).toBe(true);
  });

  it('requires contact email for a non-profile guest', () => {
    expect(createRegistrationSchema.safeParse({ ...guest, contact_email: undefined }).success).toBe(false);
  });

  it('requires kiosk channel for organizer-supervised registrations', () => {
    expect(createRegistrationSchema.safeParse({ ...guest, organizer_supervised: true }).success).toBe(false);
    expect(createRegistrationSchema.safeParse({ ...guest, organizer_supervised: true, submission_channel: 'kiosk' }).success).toBe(true);
  });

  it('accepts profile registration without contact email', () => {
    expect(createRegistrationSchema.safeParse({
      performer_name: 'Profile Performer',
      profile_id: '10000000-0000-4000-8000-000000000001',
      submission_channel: 'organic',
      organizer_supervised: false,
    }).success).toBe(true);
  });

  it('rejects unknown update fields', () => {
    expect(updateRegistrationSchema.safeParse({ contact_email: 'nope@example.test' }).success).toBe(false);
  });

  it('accepts an explicit claim attribution change', () => {
    expect(claimRegistrationSchema.safeParse({
      adopted_profile_id: null,
      sync_public_fields: false,
    }).success).toBe(true);
  });
});
