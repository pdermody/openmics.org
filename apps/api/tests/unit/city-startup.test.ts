import Fastify from 'fastify';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/cities/catalogue.js', async (importOriginal) => {
  const catalogue = await importOriginal<typeof import('../../src/cities/catalogue.js')>();
  return {
    ...catalogue,
    loadCityCatalogue: () => Promise.reject(new Error('City catalogue is unavailable')),
  };
});

import { citiesRoutes } from '../../src/cities/routes.js';

describe('city catalogue startup validation', () => {
  let app: ReturnType<typeof Fastify> | undefined;
  let pool: Pool | undefined;

  afterEach(async () => {
    await app?.close();
    await pool?.end();
  });

  it('fails application readiness when the packaged catalogue cannot be loaded', async () => {
    pool = new Pool({ connectionString: 'postgres://unused:unused@127.0.0.1:1/unused' });
    app = Fastify({ logger: false });
    app.register(citiesRoutes, { pool });

    await expect(app.ready()).rejects.toThrow('City catalogue is unavailable');
  });
});
