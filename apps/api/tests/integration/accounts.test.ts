import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('account context routes (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let accountId: string;
  let profileId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email, display_name) VALUES ('account-context-owner', 'account-context@example.test', 'Context Owner') RETURNING id",
    );
    accountId = account.rows[0].id;
    const profile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, phone) VALUES ($1, 'Context Performer', 'performer', '+353 87 555 0102') RETURNING id",
      [accountId],
    );
    profileId = profile.rows[0].id;
    app = buildApp({ db: pool, logger: false, config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 } });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(database);
  }, 30_000);

  it('returns the authenticated account and owned profiles', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer account-context-owner' } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('account-context@example.test');

    const profiles = await app.inject({ method: 'GET', url: `/api/accounts/${accountId}/profiles`, headers: { authorization: 'Bearer account-context-owner' } });
    expect(profiles.statusCode).toBe(200);
    expect(profiles.json().items[0].id).toBe(profileId);
    expect(profiles.json().items[0].phone).toBe('+353 87 555 0102');

    const publicProfile = await app.inject({ method: 'GET', url: `/api/profiles/${profileId}` });
    expect(publicProfile.statusCode).toBe(200);
    expect(publicProfile.json().phone).toBeUndefined();
  });

  it('sets current profile and returns owned permissions', async () => {
    const current = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${accountId}/current-profile`,
      headers: { authorization: 'Bearer account-context-owner' },
      payload: { profile_id: profileId },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().id).toBe(profileId);

    const permissions = await app.inject({
      method: 'GET',
      url: `/api/me/permissions?profile=${profileId}`,
      headers: { authorization: 'Bearer account-context-owner' },
    });
    expect(permissions.statusCode).toBe(200);
    expect(permissions.json().permissions).not.toContain('profiles:manage');
  });
});
