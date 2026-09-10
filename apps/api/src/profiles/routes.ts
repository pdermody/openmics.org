import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { withTransaction } from '../db.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { assignHandle } from '../handles/service.js';
import { findProfileById, findPublicProfiles, insertProfile, serializeProfile, updateProfile } from './repository.js';
import { createProfileSchema, updateProfileSchema } from './validation.js';

export type ProfilesPluginOptions = { pool: Pool };

export const profilesRoutes: FastifyPluginAsync<ProfilesPluginOptions> = async (app, { pool }) => {
  app.post('/profiles', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createProfileSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid profile payload', parsed.error.flatten());

    const account = request.account!;
    const input = parsed.data;

    const withHandle = await withTransaction(pool, async (client) => {
      const profile = await insertProfile(client, {
        createdByAccountId: account.accountId,
        profileName: input.profile_name,
        profileKind: input.profile_kind,
        bio: input.bio,
        phone: input.phone,
        visibility: input.visibility,
        themeName: input.theme_name,
        colorMode: input.color_mode,
      });
      await assignHandle(
        client,
        { entityType: 'profile', profileId: profile.id },
        { displayName: input.profile_name, requestedHandle: input.handle },
      );
      return findProfileById(client, profile.id);
    });

    reply.status(201).send(serializeProfile(withHandle!, true));
  });

  app.get<{ Querystring: { page?: string; page_size?: string } }>('/profiles', async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.query.page_size ?? 25)));
    const result = await findPublicProfiles(pool, pageSize, (page - 1) * pageSize);
    reply.send({
      items: result.rows.map((profile) => serializeProfile(profile)),
      pagination: { page, page_size: pageSize, total: result.total },
    });
  });

  app.get<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const profile = await findProfileById(pool, request.params.id);
    if (!profile || profile.visibility === 'private' || profile.is_hidden || profile.is_blacklisted) {
      throw new NotFoundError('Profile not found');
    }
    reply.send(serializeProfile(profile));
  });

  app.patch<{ Params: { id: string } }>('/profiles/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid profile payload', parsed.error.flatten());

    const existing = await findProfileById(pool, request.params.id);
    if (!existing) throw new NotFoundError('Profile not found');

    const account = request.account!;
    if (existing.created_by_account_id !== account.accountId && !account.isPlatformAdmin) {
      throw new ForbiddenError('You do not own this profile');
    }

    const updated = await updateProfile(pool, request.params.id, parsed.data);
    reply.send(serializeProfile(updated!, true));
  });
};
