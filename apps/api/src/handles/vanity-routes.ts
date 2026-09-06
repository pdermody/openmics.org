import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { GoneError, NotFoundError } from '../errors.js';
import { findHandleResolution, findPublicEntity, type HandleResolution, type PublicResolvedEntity } from './resolver.js';

export type VanityRoutesOptions = {
  pool: Pool;
  publicBaseUrl?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDocument(
  requestedHandle: string,
  canonicalHandle: string,
  resolved: PublicResolvedEntity,
  publicBaseUrl: string,
): string {
  const name = resolved.type === 'profile'
    ? (resolved.entity as ReturnType<typeof import('../profiles/repository.js').serializeProfile>).profile_name
    : (resolved.entity as ReturnType<typeof import('../open-mics/repository.js').serializeOpenMic>).name;
  const canonicalUrl = `${publicBaseUrl}/@${encodeURIComponent(canonicalHandle)}`;
  const payload = JSON.stringify({
    type: resolved.type,
    canonical_handle: canonicalHandle,
    requested_handle: requestedHandle,
    status: 'current',
    entity: resolved.entity,
  }).replace(/</g, '\\u003c');
  const title = `${name} | Open Mic`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="canonical" href="${escapeHtml(canonicalUrl)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:url" content="${escapeHtml(canonicalUrl)}"></head><body><div id="root"></div><script type="application/json" id="open-mic-resolved">${payload}</script><script type="module" src="/assets/main.js"></script></body></html>`;
}

async function handleVanityRequest(
  request: FastifyRequest<{ Params: { handle: string } }>,
  reply: FastifyReply,
  pool: Pool,
  publicBaseUrl: string,
): Promise<void> {
  const requestedHandle = request.params.handle;
  const resolution = await findHandleResolution(pool, requestedHandle);
  if (!resolution) throw new NotFoundError('Handle not found');

  if (resolution.status === 'tombstoned') throw new GoneError('Handle is no longer available');
  if (resolution.status !== 'current' && resolution.status !== 'redirect') {
    throw new NotFoundError('Handle not found');
  }
  if (resolution.status === 'redirect') {
    if (!resolution.redirects_to_handle || !resolution.redirect_expires_at || resolution.redirect_expires_at.getTime() <= Date.now()) {
      throw new NotFoundError('Handle not found');
    }
    const target = await findHandleResolution(pool, resolution.redirects_to_handle);
    if (!target || target.status !== 'current') throw new NotFoundError('Handle not found');
    const entity = await findPublicEntity(pool, target);
    if (!entity) throw new NotFoundError('Handle not found');
    reply.code(301).redirect(`/@${encodeURIComponent(target.handle)}`);
    return;
  }

  const entity = await findPublicEntity(pool, resolution);
  if (!entity) throw new NotFoundError('Handle not found');
  if (requestedHandle !== resolution.handle) {
    reply.code(301).redirect(`/@${encodeURIComponent(resolution.handle)}`);
    return;
  }

  reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'public, max-age=60')
    .send(renderDocument(requestedHandle, resolution.handle, entity, publicBaseUrl));
}

export const vanityRoutes: FastifyPluginAsync<VanityRoutesOptions> = async (app, options) => {
  const publicBaseUrl = options.publicBaseUrl ?? 'https://openmics.org';
  const handler = (request: FastifyRequest<{ Params: { handle: string } }>, reply: FastifyReply) =>
    handleVanityRequest(request, reply, options.pool, publicBaseUrl);

  app.get<{ Params: { handle: string } }>('/@:handle', handler);
  app.get<{ Params: { handle: string } }>('/@:handle/', handler);
};

export { handleVanityRequest };
