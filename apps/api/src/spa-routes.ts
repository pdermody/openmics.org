import { readFileSync } from 'node:fs';

import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import type { AppConfig } from './config.js';
import { resolveAltText, type MediaDisplayContext } from './media/captions.js';
import { findMediaById, isMediaPubliclyVisible, type MediaListRow } from './media/repository.js';
import { resolveCurrentHandle } from './handles/repository.js';
import { findOpenMicByIdOrPublicCode } from './open-mics/repository.js';
import { findEventByIdOrPublicCode } from './events/repository.js';

export type SpaRoutesOptions = {
  entryPoint?: string;
  resolveHandle?: (handle: string) => ReturnType<typeof resolveCurrentHandle>;
  /** When present, GET /media/:mediaId serves OG-stamped HTML (design §12.4). */
  pool?: Pool;
  config?: Pick<AppConfig, 'appBaseUrl' | 'spaIndexHtmlPath'>;
};

const DEFAULT_ENTRY_POINT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenMics.org</title></head><body><div id="root"></div></body></html>';

const SITE_NAME = 'OpenMics.org';

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type OgTags = {
  title: string;
  description?: string;
  image?: string;
  url: string;
};

/** String-template injection into `<head>` — dependency-free by design. */
export function injectOgTags(html: string, tags: OgTags): string {
  const pairs: Array<[property: string, content: string]> = [
    ['og:title', tags.title],
    ['og:site_name', SITE_NAME],
    ['og:url', tags.url],
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', tags.title],
  ];
  if (tags.description) {
    pairs.push(['og:description', tags.description], ['twitter:description', tags.description]);
  }
  if (tags.image) {
    pairs.push(['og:image', tags.image], ['twitter:image', tags.image]);
  }
  // Deliberately no og:video (design §12.3): clicks always land back on the site.
  const markup = pairs
    .map(([property, content]) => {
      const escaped = escapeHtmlAttribute(content);
      const attr = property.startsWith('twitter:') ? `name="${property}"` : `property="${property}"`;
      return `<meta ${attr} content="${escaped}">`;
    })
    .join('');
  return html.includes('</head>') ? html.replace('</head>', `${markup}</head>`) : markup + html;
}

function formatOgDate(startsAt: Date | null, timeZone: string | null): string | null {
  if (!startsAt) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timeZone ?? 'UTC' }).format(startsAt);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(startsAt);
  }
}

/** OG tags for a visible media item (design §12.3). */
export function mediaOgTags(media: MediaListRow, appBaseUrl: string): OgTags {
  const context: MediaDisplayContext = {
    performerName: media.attribution_name,
    performerCity: media.attribution_city,
    eventName: media.event_name,
    eventDate: formatOgDate(media.event_starts_at, media.event_time_zone),
    seriesName: media.series_name,
  };
  // og:title = the substituted caption, with the same fallback as photo alt text.
  const title = resolveAltText({ mediaType: media.media_type, caption: media.caption }, context);
  const descriptionParts = [media.event_name, formatOgDate(media.event_starts_at, media.event_time_zone)].filter(
    (part): part is string => Boolean(part),
  );
  const image = media.media_type === 'video'
    ? media.thumbnail_url ?? undefined
    : media.renditions?.lightbox?.url ?? media.source_url;
  return {
    title,
    description: descriptionParts.length > 0 ? descriptionParts.join(' · ') : undefined,
    image,
    url: `${appBaseUrl}/media/${media.id}`,
  };
}

/** Fallback OG for hidden/stale deep-links: the surrounding event or series (no image — no cover columns exist). */
export function fallbackOgTags(media: MediaListRow, appBaseUrl: string): OgTags {
  if (media.series_deleted_at || media.series_status !== 'active') return { title: SITE_NAME, url: appBaseUrl };
  if (media.event_id && media.event_name) {
    const url = media.series_handle
      ? `${appBaseUrl}/@${media.series_handle}/events/${media.event_id}`
      : `${appBaseUrl}/events/${media.event_id}`;
    return { title: media.event_name, url };
  }
  if (media.series_id && media.series_name) {
    const url = media.series_handle
      ? `${appBaseUrl}/@${media.series_handle}`
      : `${appBaseUrl}/open-mics/${media.series_id}`;
    return { title: media.series_name, url };
  }
  return { title: SITE_NAME, url: appBaseUrl };
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const spaRoutes: FastifyPluginAsync<SpaRoutesOptions> = async (app, options) => {
  // The real SPA shell is baked into the image by apps/api/Dockerfile; local dev and
  // tests without a web build fall back to the placeholder.
  let entryPoint = options.entryPoint ?? DEFAULT_ENTRY_POINT;
  if (!options.entryPoint && options.config?.spaIndexHtmlPath) {
    try {
      entryPoint = readFileSync(options.config.spaIndexHtmlPath, 'utf8');
    } catch {
      app.log.debug({ path: options.config.spaIndexHtmlPath }, 'SPA index.html not found; using placeholder entry point');
    }
  }

  if (options.pool && options.config) {
    const { pool, config } = options;
    async function publicCanonicalPath(identifier: string, eventIdentifier?: string) {
      const parent = await findOpenMicByIdOrPublicCode(pool, identifier);
      if (!parent || parent.status !== 'active' || !parent.current_handle) return null;
      if (!eventIdentifier) return `/@${parent.current_handle}`;
      const event = await findEventByIdOrPublicCode(pool, eventIdentifier);
      if (!event || event.open_mic_id !== parent.id || event.status !== 'published') return null;
      return `/@${parent.current_handle}/events/${event.id}`;
    }
    for (const suffix of ['/details', '/events/:eventId', '/events/:eventId/details']) {
      app.get<{ Params: { handle: string; eventId?: string } }>(`/@:handle${suffix}`, async (request, reply) => {
        const resolution = await (options.resolveHandle ?? ((handle: string) => resolveCurrentHandle(pool, handle)))(request.params.handle);
        const base = resolution?.entityType === 'open_mic' && resolution.openMicId
          ? await publicCanonicalPath(resolution.openMicId, request.params.eventId) : null;
        if (!base) return reply.code(404).type('text/html; charset=utf-8').send(entryPoint);
        const canonical = base + (suffix.endsWith('/details') ? '/details' : '');
        const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
        if (request.url.split('?')[0] !== canonical) return reply.redirect(`${canonical}${query}`, 301);
        return reply.type('text/html; charset=utf-8').send(entryPoint);
      });
    }
    app.get<{ Params: { id: string } }>('/open-mics/:id/details', async (request, reply) => {
      const base = await publicCanonicalPath(request.params.id);
      if (!base) return reply.code(404).type('text/html; charset=utf-8').send(entryPoint);
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      return reply.redirect(`${base}/details${query}`, 301);
    });
    app.get<{ Params: { id: string } }>('/events/:id/details', async (request, reply) => {
      const event = await findEventByIdOrPublicCode(pool, request.params.id);
      const base = event ? await publicCanonicalPath(event.open_mic_id, event.id) : null;
      if (!base) return reply.code(404).type('text/html; charset=utf-8').send(entryPoint);
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      return reply.redirect(`${base}/details${query}`, 301);
    });
    // Registered BEFORE the catch-all. Social scrapers get server-stamped OG tags; the
    // route always returns 200 HTML — a scraper never sees a 404 (design §12.4).
    app.get<{ Params: { mediaId: string } }>('/media/:mediaId', async (request, reply) => {
      let tags: OgTags = { title: SITE_NAME, url: config.appBaseUrl };
      if (UUID_PATTERN.test(request.params.mediaId)) {
        const media = await findMediaById(pool, request.params.mediaId);
        if (media) {
          tags = isMediaPubliclyVisible(media) ? mediaOgTags(media, config.appBaseUrl) : fallbackOgTags(media, config.appBaseUrl);
        }
      }
      reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'public, s-maxage=3600, max-age=0')
        .send(injectOgTags(entryPoint, tags));
    });
  }

  app.get('/*', async (request, reply) => {
    if (request.url === '/api' || request.url.startsWith('/api/')) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
      return;
    }
    reply.type('text/html; charset=utf-8').send(entryPoint);
  });
};

export { DEFAULT_ENTRY_POINT };
