import { describe, expect, it } from 'vitest';

import { createEventSchema, updateEventSchema } from '../../src/events/validation.js';

const validBase = {
  title: 'Test Event',
  starts_at: '2026-12-15T19:00:00Z',
  time_zone: 'Europe/Dublin',
};

describe('events validation cross-field rules', () => {
  it('accepts a minimal valid create payload', () => {
    const result = createEventSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('rejects ends_at before starts_at', () => {
    const result = createEventSchema.safeParse({
      ...validBase,
      ends_at: '2026-12-15T18:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts ends_at after starts_at', () => {
    const result = createEventSchema.safeParse({
      ...validBase,
      ends_at: '2026-12-15T21:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects lat without lng and vice versa', () => {
    expect(createEventSchema.safeParse({ ...validBase, lat: 53.3 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...validBase, lng: -6.3 }).success).toBe(false);
  });

  it('accepts lat and lng provided together', () => {
    const result = createEventSchema.safeParse({
      ...validBase,
      lat: 53.3,
      lng: -6.3,
      venue_name: 'Test Venue',
      address_line1: '1 Test St',
      city: 'Dublin',
      country: 'IE',
    });
    expect(result.success).toBe(true);
  });

  it('enforces location snapshot atomicity: all location fields or none', () => {
    // Missing city, country
    const partialLocation = createEventSchema.safeParse({
      ...validBase,
      venue_name: 'Test Venue',
      address_line1: '1 Test St',
      lat: 53.3,
      lng: -6.3,
    });
    expect(partialLocation.success).toBe(false);

    // All location fields provided
    const completeLocation = createEventSchema.safeParse({
      ...validBase,
      venue_name: 'Test Venue',
      address_line1: '1 Test St',
      city: 'Dublin',
      country: 'IE',
      lat: 53.3,
      lng: -6.3,
    });
    expect(completeLocation.success).toBe(true);
  });

  it('rejects entry_fee_amount > 0 without entry_fee_currency', () => {
    const result = createEventSchema.safeParse({ ...validBase, entry_fee_amount: 5 });
    expect(result.success).toBe(false);
  });

  it('accepts entry_fee_amount of 0 without entry_fee_currency', () => {
    const result = createEventSchema.safeParse({ ...validBase, entry_fee_amount: 0 });
    expect(result.success).toBe(true);
  });

  it('allows a partial update payload without create-only required fields', () => {
    const result = updateEventSchema.safeParse({ notes: 'Updated notes' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields on create', () => {
    const result = createEventSchema.safeParse({ ...validBase, unexpected_field: 'nope' });
    expect(result.success).toBe(false);
  });

  it('applies the same cross-field rules to update payloads', () => {
    const result = updateEventSchema.safeParse({ ends_at: '2026-12-15T18:00:00Z', starts_at: '2026-12-15T19:00:00Z' });
    expect(result.success).toBe(false);
  });
});
