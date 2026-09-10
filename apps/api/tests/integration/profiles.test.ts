import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('profiles routes (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let ownerAccount: { id: string; cognitoId: string };
  let otherAccount: { id: string; cognitoId: string };

  const app = () =>
    buildApp({
      db: pool,
      logger: false,
      config: {
        databaseUrl: 'unused',
        environment: 'test',
        host: '127.0.0.1',
        port: 3000,
      },
    });

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;

    const owner = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('profiles-owner', 'profiles-owner@example.test') RETURNING id",
    );
    ownerAccount = { id: owner.rows[0].id, cognitoId: 'profiles-owner' };

    const other = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('profiles-other', 'profiles-other@example.test') RETURNING id",
    );
    otherAccount = { id: other.rows[0].id, cognitoId: 'profiles-other' };
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(database);
  }, 30_000);

  it('creates a profile with an auto-generated handle', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${ownerAccount.cognitoId}` },
      payload: { profile_name: 'Portlaoise Spotlight Sessions', profile_kind: 'organizer' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().current_handle).toBe('portlaoise-spotlight-sessions');
    await instance.close();
  });

  it('creates a profile with an explicit handle, then rejects a second profile requesting the same handle', async () => {
    const instance = app();

    const first = await instance.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${ownerAccount.cognitoId}` },
      payload: { profile_name: 'Explicit Handle Profile', profile_kind: 'performer', handle: 'my-explicit-handle' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().current_handle).toBe('my-explicit-handle');

    const second = await instance.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${otherAccount.cognitoId}` },
      payload: { profile_name: 'Another Profile', profile_kind: 'performer', handle: 'my-explicit-handle' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('HANDLE_UNAVAILABLE');
    expect(second.json().holder_type).toBe('profile');

    await instance.close();
  });

  it('returns 404 for a profile that does not exist', async () => {
    const instance = app();
    const response = await instance.inject({ method: 'GET', url: '/api/profiles/00000000-0000-0000-0000-000000000000' });
    expect(response.statusCode).toBe(404);
    await instance.close();
  });

  it('allows the owner to update their profile but forbids other accounts', async () => {
    const instance = app();

    const created = await instance.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${ownerAccount.cognitoId}` },
      payload: { profile_name: 'Ownership Test', profile_kind: 'performer' },
    });
    const profileId = created.json().id as string;

    const forbidden = await instance.inject({
      method: 'PATCH',
      url: `/api/profiles/${profileId}`,
      headers: { authorization: `Bearer ${otherAccount.cognitoId}` },
      payload: { bio: 'Hijacked bio' },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await instance.inject({
      method: 'PATCH',
      url: `/api/profiles/${profileId}`,
      headers: { authorization: `Bearer ${ownerAccount.cognitoId}` },
      payload: { bio: 'Updated by owner' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().bio).toBe('Updated by owner');

    await instance.close();
  });

  it('stores and updates theme_name and color_mode preferences on a profile', async () => {
    const instance = app();

    const created = await instance.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${ownerAccount.cognitoId}` },
      payload: { profile_name: 'Preferences Test', profile_kind: 'performer', theme_name: 'sunset', color_mode: 'dark' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().theme_name).toBe('sunset');
    expect(created.json().color_mode).toBe('dark');

    const profileId = created.json().id as string;
    const updated = await instance.inject({
      method: 'PATCH',
      url: `/api/profiles/${profileId}`,
      headers: { authorization: `Bearer ${ownerAccount.cognitoId}` },
      payload: { color_mode: 'light' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().color_mode).toBe('light');
    expect(updated.json().theme_name).toBe('sunset');

    await instance.close();
  });
});
