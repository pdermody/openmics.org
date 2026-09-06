import { describe, expect, it } from 'vitest';

import { createOpenMicSchema, updateOpenMicSchema } from '../../src/open-mics/validation.js';

const validBase = {
  name: 'Test Open Mic',
  venue_name: 'Test Venue',
  address_line1: '1 Test St',
  city: 'Dublin',
  country: 'IE',
  time_zone: 'Europe/Dublin',
  activities: ['singing'] as const,
};

describe('open-mics validation cross-field rules', () => {
  it('accepts a minimal valid create payload', () => {
    const result = createOpenMicSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('rejects registration_mode=external without external_registration_url', () => {
    const result = createOpenMicSchema.safeParse({ ...validBase, registration_mode: 'external' });
    expect(result.success).toBe(false);
  });

  it('accepts registration_mode=external with external_registration_url', () => {
    const result = createOpenMicSchema.safeParse({
      ...validBase,
      registration_mode: 'external',
      external_registration_url: 'https://example.test/signup',
    });
    expect(result.success).toBe(true);
  });

  it('rejects entry_fee_amount > 0 without entry_fee_currency', () => {
    const result = createOpenMicSchema.safeParse({ ...validBase, entry_fee_amount: 5 });
    expect(result.success).toBe(false);
  });

  it('accepts entry_fee_amount of 0 without entry_fee_currency', () => {
    const result = createOpenMicSchema.safeParse({ ...validBase, entry_fee_amount: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects lat without lng and vice versa', () => {
    expect(createOpenMicSchema.safeParse({ ...validBase, lat: 53.3 }).success).toBe(false);
    expect(createOpenMicSchema.safeParse({ ...validBase, lng: -6.3 }).success).toBe(false);
  });

  it('accepts lat and lng provided together', () => {
    const result = createOpenMicSchema.safeParse({ ...validBase, lat: 53.3, lng: -6.3 });
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields on create (strict via required base object)', () => {
    const result = createOpenMicSchema.safeParse({ ...validBase, unexpected_field: 'nope' });
    expect(result.success).toBe(false);
  });

  it('allows a partial update payload without the create-only required fields', () => {
    const result = updateOpenMicSchema.safeParse({ description: 'Updated description' });
    expect(result.success).toBe(true);
  });

  it('rejects handle on update payloads', () => {
    const result = updateOpenMicSchema.safeParse({ handle: 'new-handle' });
    expect(result.success).toBe(false);
  });

  it('applies the same cross-field rules to update payloads', () => {
    const result = updateOpenMicSchema.safeParse({ registration_mode: 'external' });
    expect(result.success).toBe(false);
  });
});
