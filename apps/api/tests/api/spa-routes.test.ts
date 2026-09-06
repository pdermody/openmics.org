import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('SPA entry point', () => {
  const app = buildApp({
    config: { databaseUrl: 'postgres://unused', environment: 'test', host: '127.0.0.1', port: 3000 },
    logger: false,
    handles: { checkAvailability: async () => ({ available: true }) },
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('returns the same entry point for browser routes', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    const vanity = await app.inject({ method: 'GET', url: '/@unknown-profile/events/123' });
    const registration = await app.inject({ method: 'GET', url: '/events/123/register' });

    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(vanity.body).toBe(root.body);
    expect(registration.body).toBe(root.body);
  });

  it('does not replace API responses with the SPA entry point', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).not.toContain('text/html');
  });
});
