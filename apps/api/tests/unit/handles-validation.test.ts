import { describe, expect, it } from 'vitest';

import { isValidHandleFormat } from '../../src/handles/validation.js';

describe('isValidHandleFormat', () => {
  it('accepts a well-formed handle', () => {
    expect(isValidHandleFormat('paul-dermody')).toBe(true);
  });

  it('rejects handles shorter than 3 characters', () => {
    expect(isValidHandleFormat('ab')).toBe(false);
  });

  it('rejects leading and trailing hyphens', () => {
    expect(isValidHandleFormat('-paul')).toBe(false);
    expect(isValidHandleFormat('paul-')).toBe(false);
  });

  it('rejects all-digit handles', () => {
    expect(isValidHandleFormat('123456')).toBe(false);
  });

  it('rejects UUID-shaped handles', () => {
    expect(isValidHandleFormat('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('rejects non-ASCII characters', () => {
    expect(isValidHandleFormat('рaul-dermody')).toBe(false);
  });
});
