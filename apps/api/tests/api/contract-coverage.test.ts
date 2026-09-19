import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('OpenAPI contract boundary coverage', () => {
  const app = buildApp({
    config: {
      databaseUrl: 'postgres://openmic:openmic_local@127.0.0.1:5432/openmic_test',
      environment: 'test',
      host: '127.0.0.1',
      port: 3000,
    },
    logger: false,
    authVerifier: vi.fn(async () => null),
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('GET /me/claimable-registrations rejects unauthenticated requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me/claimable-registrations' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('GET /auth/profile rejects unauthenticated requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/profile' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('DELETE /open-mics/:id rejects unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });
});