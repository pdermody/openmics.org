import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('GET /api/handles/check/:candidate', () => {
  const checkAvailability = vi.fn(async (candidate: string) =>
    candidate === 'paul-dermody' ? { available: false, reason: 'in_use' as const } : { available: true },
  );

  const app = buildApp({
    config: {
      databaseUrl: 'postgres://openmic:openmic_local@127.0.0.1:5432/openmic_test',
      environment: 'test',
      host: '127.0.0.1',
      port: 3000,
    },
    logger: false,
    handles: { checkAvailability },
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('rejects a malformed candidate without consulting the repository', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/handles/check/ab' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false, reason: 'invalid_format' });
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  it('delegates well-formed candidates to the repository', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/handles/check/paul-dermody' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false, reason: 'in_use' });
    expect(checkAvailability).toHaveBeenCalledWith('paul-dermody');
  });

  it('reports availability for an unclaimed well-formed candidate', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/handles/check/brand-new-handle' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: true });
  });
});
