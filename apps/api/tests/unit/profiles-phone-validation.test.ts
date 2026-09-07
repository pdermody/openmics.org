import { describe, expect, it } from 'vitest';

import { createProfileSchema, updateProfileSchema } from '../../src/profiles/validation.js';

describe('profile phone validation', () => {
  it('accepts a valid phone on create and update', () => {
    expect(createProfileSchema.safeParse({ profile_name: 'Performer', profile_kind: 'performer', phone: '+353 87 555 0102' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ phone: '+353 87 555 0102' }).success).toBe(true);
  });

  it('rejects an implausibly short phone value', () => {
    expect(updateProfileSchema.safeParse({ phone: '123' }).success).toBe(false);
  });
});
