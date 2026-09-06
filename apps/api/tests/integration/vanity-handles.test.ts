import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('public vanity handle resolver', () => {
  let database: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('vanity-owner', 'vanity@example.test') RETURNING id",
    );
    const profile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, visibility) VALUES ($1, 'Public Singer', 'performer', 'public') RETURNING id",
      [account.rows[0].id],
    );
    await pool.query(
      "INSERT INTO handles (handle, entity_type, profile_id, status) VALUES ('Public-Singer', 'profile', $1, 'current')",
      [profile.rows[0].id],
    );
    await pool.query(
      `INSERT INTO handles (handle, entity_type, profile_id, status, redirects_to_handle, redirect_expires_at)
       VALUES ('old-singer', 'profile', $1, 'redirect', 'Public-Singer', now() + interval '30 days')`,
      [profile.rows[0].id],
    );
    await pool.query("INSERT INTO handles (handle, status) VALUES ('gone-singer', 'tombstoned')");
    await pool.query(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, visibility) VALUES ($1, 'Private Singer', 'performer', 'private')",
      [account.rows[0].id],
    );
    const privateProfile = await pool.query<{ id: string }>(
      "SELECT id FROM profiles WHERE profile_name = 'Private Singer'",
    );
    await pool.query(
      "INSERT INTO handles (handle, entity_type, profile_id, status) VALUES ('Private-Singer', 'profile', $1, 'current')",
      [privateProfile.rows[0].id],
    );
    app = buildApp({ db: pool, logger: false, config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 } });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(database);
  }, 30_000);

  it('renders a public current handle as HTML with resolved payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/@Public-Singer' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Public Singer');
    expect(response.body).toContain('"type":"profile"');
  });

  it('redirects case variants and retired handles to canonical casing', async () => {
    const caseVariant = await app.inject({ method: 'GET', url: '/@public-singer' });
    expect(caseVariant.statusCode).toBe(301);
    expect(caseVariant.headers.location).toBe('/@Public-Singer');

    const retired = await app.inject({ method: 'GET', url: '/@old-singer' });
    expect(retired.statusCode).toBe(301);
    expect(retired.headers.location).toBe('/@Public-Singer');
  });

  it('hides private and tombstoned handles', async () => {
    const privateResponse = await app.inject({ method: 'GET', url: '/@Private-Singer' });
    expect(privateResponse.statusCode).toBe(404);

    const tombstoned = await app.inject({ method: 'GET', url: '/@gone-singer' });
    expect(tombstoned.statusCode).toBe(410);
    expect(tombstoned.json().error.code).toBe('GONE');
  });
});
