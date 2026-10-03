// Caption token substitution and default captions for the media pipeline
// (media-gallery-design.md §7).
//
// IMPORTANT: this file is mirrored by apps/web/src/features/media-captions.ts, which the
// caption editor's live preview uses. The token mechanics here are language-neutral and
// MUST stay behavior-identical between the two copies — mirrored unit tests pin the
// contract. The localized default-caption *strings* are intentionally NOT shared: the
// web renders them via i18next (en/es), while this server copy holds English-only
// defaults for OG tags and alt text (settled 2026-10-02 — the API has no i18n runtime).

export type CaptionValues = {
  performerName?: string | null;
  performerCity?: string | null;
  eventName?: string | null;
  /** Preformatted display date (the API formats from starts_at + time_zone). */
  eventDate?: string | null;
};

export const CAPTION_TOKEN_NAMES = ['performer_name', 'performer_city', 'event_name', 'event_date'] as const;
export type CaptionTokenName = (typeof CAPTION_TOKEN_NAMES)[number];

const TOKEN_PATTERN = /\{\s*(performer_name|performer_city|event_name|event_date)\s*\}/g;

const TOKEN_VALUE_KEYS: Record<CaptionTokenName, keyof CaptionValues> = {
  performer_name: 'performerName',
  performer_city: 'performerCity',
  event_name: 'eventName',
  event_date: 'eventDate',
};

const SEPARATOR_CLASS = '—–\\-·•|,;:';
const SEPARATOR_RUN_START = new RegExp(`^[\\s${SEPARATOR_CLASS}]+`);
const SEPARATOR_RUN_END = new RegExp(`[\\s${SEPARATOR_CLASS}]+$`);
const SEPARATOR_ADJACENT = new RegExp(`([${SEPARATOR_CLASS}])\\s+(?=[${SEPARATOR_CLASS}])`, 'g');

/**
 * Substitutes the four caption tokens. A token with no value is dropped along with
 * surrounding whitespace, dashes, and punctuation (design §7.3) so organizer-written
 * captions never render "Amy Hart —" or "Amy Hart from Unknown". Unknown `{tokens}`
 * are left untouched so organizers see their typo rather than a silent deletion.
 */
export function substituteCaption(template: string, values: CaptionValues): string {
  let out = template.replace(TOKEN_PATTERN, (_match, name: CaptionTokenName) => {
    const value = values[TOKEN_VALUE_KEYS[name]];
    return value?.trim() ?? '';
  });

  // Fixpoint cleanup: collapse whitespace, strip orphaned separators at the boundaries
  // and between each other, until no rule fires anymore.
  let previous: string;
  do {
    previous = out;
    out = out.replace(/\s{2,}/g, ' ');
    out = out.replace(SEPARATOR_RUN_START, '');
    out = out.replace(SEPARATOR_RUN_END, '');
    out = out.replace(SEPARATOR_ADJACENT, '$1');
  } while (out !== previous);

  return out.trim();
}

/** Tokens that can actually resolve for a media item (fewer for free-standing media). */
export function availableCaptionTokens(scope: { attributed: boolean; eventScoped: boolean }): CaptionTokenName[] {
  const tokens: CaptionTokenName[] = [];
  if (scope.attributed) tokens.push('performer_name', 'performer_city');
  if (scope.eventScoped) tokens.push('event_name', 'event_date');
  return tokens;
}

/**
 * English default captions (design §7.2) for server-side OG/alt-text output. Paired
 * with/without-city shapes so a missing city reads naturally instead of leaving a hole.
 * Free-standing media has no default caption (empty string).
 */
export function defaultCaptionEn(values: CaptionValues, form: 'short' | 'long'): string {
  const name = values.performerName?.trim() || null;
  const city = values.performerCity?.trim() || null;
  if (!name) return '';
  const performer = city ? `${name} from ${city}` : name;
  if (form === 'short') return performer;
  const eventName = values.eventName?.trim() || null;
  const eventDate = values.eventDate?.trim() || null;
  if (eventName && eventDate) return `${performer} at ${eventName} on ${eventDate}`;
  if (eventName) return `${performer} at ${eventName}`;
  if (eventDate) return `${performer} on ${eventDate}`;
  return performer;
}

export type MediaDisplayContext = CaptionValues & {
  /** Series name for series-scope free-standing fallbacks. */
  seriesName?: string | null;
};

/**
 * The caption as displayed to the public: the organizer's substituted template when one
 * is set, otherwise the short-form default. '' when nothing resolves (free-standing
 * media with no caption renders no caption line).
 */
export function resolveCaption(caption: string | null, context: MediaDisplayContext): string {
  if (caption?.trim()) return substituteCaption(caption, context);
  return defaultCaptionEn(context, 'short');
}

/**
 * Photo alt text (design §6.6): the full substituted caption, falling back to
 * "Photo from {event_name}" (or the series name for series-scope media).
 */
export function resolveAltText(
  media: { mediaType: 'photo' | 'video'; caption: string | null },
  context: MediaDisplayContext,
): string {
  const resolved = resolveCaption(media.caption, context);
  if (resolved) return resolved;
  const subject = context.eventName?.trim() || context.seriesName?.trim() || null;
  const noun = media.mediaType === 'video' ? 'Video' : 'Photo';
  return subject ? `${noun} from ${subject}` : `${noun} from an open mic`;
}
