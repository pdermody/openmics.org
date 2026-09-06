import { describe, expect, it } from 'vitest';

import { createPerformanceSchema, updatePerformanceSchema } from '../../src/performances/validation.js';

describe('performance validation', () => {
  it('accepts a valid performance', () => {
    expect(createPerformanceSchema.safeParse({
      registration_id: '10000000-0000-4000-8000-000000000001',
      name: 'First song',
      activity: 'singing',
      sequence: 1,
    }).success).toBe(true);
  });

  it('rejects invalid status and sequence values', () => {
    expect(createPerformanceSchema.safeParse({
      registration_id: '10000000-0000-4000-8000-000000000001',
      name: 'First song',
      status: 'planned',
      sequence: 0,
    }).success).toBe(false);
  });

  it('supports partial updates', () => {
    expect(updatePerformanceSchema.safeParse({ status: 'performed' }).success).toBe(true);
  });
});
