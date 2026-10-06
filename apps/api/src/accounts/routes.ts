import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireActiveCityById } from '../cities/repository.js';
import { serializeProfile } from '../profiles/repository.js';
import { findAccountById, findAccountProfiles, serializeAccount, setCurrentProfile, updateAccount } from './repository.js';
import { updateAccountSchema } from './validation.js';

export type AccountsPluginOptions = { pool: Pool };

export const accountsRoutes: FastifyPluginAsync<AccountsPluginOptions> = async (app, { pool }) => {
  const accountResponse = async (accountId: string) => {
    const account = await findAccountById(pool, accountId);
    if (!account) throw new NotFoundError('Account not found');
    return serializeAccount(account);
  };

  app.get('/auth/profile', { preHandler: app.authenticate }, async (request, reply) => {
    reply.send(await accountResponse(request.account!.accountId));
  });

  app.get('/me', { preHandler: app.authenticate }, async (request, reply) => {
    reply.send(await accountResponse(request.account!.accountId));
  });

  app.patch<{ Params: { id: string } }>('/accounts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const account = request.account!;
    if (request.params.id !== account.accountId && !account.isPlatformAdmin) {
      throw new ForbiddenError('You cannot update another account');
    }

    const parsed = updateAccountSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid account payload', parsed.error.flatten());

    const changes: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.city_id) {
      const city = await requireActiveCityById(pool, parsed.data.city_id, 'city_id');
      if (parsed.data.city && parsed.data.city.toLocaleLowerCase() !== city.city.toLocaleLowerCase()) {
        throw new ValidationError('city must match the selected city', { field: 'city_id' });
      }
      changes.city = city.city;
    } else if (parsed.data.city_id === null || parsed.data.city !== undefined) {
      changes.city_id = null;
    } else {
      const existing = await findAccountById(pool, request.params.id);
      if (existing?.city_id) await requireActiveCityById(pool, existing.city_id, 'city_id');
    }
    const updated = await updateAccount(pool, request.params.id, changes);
    if (!updated) throw new NotFoundError('Account not found');
    reply.send(serializeAccount(updated));
  });

  app.get<{ Params: { id: string } }>('/accounts/:id/profiles', { preHandler: app.authenticate }, async (request, reply) => {
    const account = request.account!;
    if (request.params.id !== account.accountId && !account.isPlatformAdmin) throw new ForbiddenError('You cannot view another account\'s profiles');
    const profiles = await findAccountProfiles(pool, request.params.id);
    reply.send({ items: profiles.map((profile) => serializeProfile(profile, true)), pagination: { page: 1, page_size: 100, total: profiles.length } });
  });

  app.put<{ Params: { id: string }; Body: { profile_id?: string } }>(
    '/accounts/:id/current-profile',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const account = request.account!;
      if (request.params.id !== account.accountId && !account.isPlatformAdmin) throw new ForbiddenError('You cannot change another account\'s current profile');
      if (!request.body?.profile_id) throw new ValidationError('profile_id is required', { field: 'profile_id' });
      const profile = await setCurrentProfile(pool, request.params.id, request.body.profile_id);
      if (!profile) throw new NotFoundError('Profile not found for this account');
      reply.send(serializeProfile(profile, true));
    },
  );

  app.get<{ Querystring: { profile?: string } }>('/me/permissions', { preHandler: app.authenticate }, async (request, reply) => {
    const profileId = request.query.profile;
    let profileKind: string | undefined;
    if (profileId) {
      const profiles = await findAccountProfiles(pool, request.account!.accountId);
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile && !request.account!.isPlatformAdmin) {
        throw new ForbiddenError('You do not own this profile');
      }
      profileKind = profile?.profile_kind;
    }
    const permissions = request.account!.isPlatformAdmin
      ? ['platform_admin']
      : ['account:read', ...(profileKind === 'organizer' ? ['profiles:manage', 'registrations:manage'] : [])];
    reply.send({ permissions });
  });
};
