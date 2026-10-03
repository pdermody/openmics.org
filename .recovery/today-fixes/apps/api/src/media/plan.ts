import { MediaQuotaExceededError, MediaUploadInvalidError, PlanLimitExceededError } from '../errors.js';

// The Phase 1 organizer plan is a single hard-coded object applied to every organizer
// (decisions.md → "Organizer DEFAULT_PLAN values (Phase 1, config-only)"). There is no
// Plans table and no Accounts.plan_id column — a second plan is a config change plus
// (then and only then) a migration.
//
// The Plan deliberately extends beyond media quotas (scale caps + reserved conversion
// levers). Media-only consumers read only the media fields. Reserved fields are shape
// only: the API ignores them because the gated features don't exist yet.
export type Plan = {
  // Media quotas (enforced in Phase 1)
  allowedPhotoMimeTypes: readonly string[];
  maxPhotoBytes: number;
  maxPhotosPerEvent: number;
  maxVideosPerEvent: number;
  maxMediaBytesPerAccount: number;
  presignExpirySeconds: number;
  /** Fixed rendition variants (sizes live with the rendition pipeline); not plan-tunable. */
  renditionVariants: readonly ['thumb', 'grid', 'lightbox'];
  // Capacity caps (enforced in Phase 1, outside the media domain)
  maxSeriesPerOrganizer: number;
  maxEventsPerSeries: number;
  maxEventCapacity: number;
  // Reserved conversion-lever fields (shape only — not enforced until the feature ships)
  assistantsPerSeries: number;
  customBrandingEnabled: boolean;
  customDomainEnabled: boolean;
  analyticsTier: 'basic';
  dataExportEnabled: boolean;
  bulkMediaDownloadEnabled: boolean;
  calendarInviteAttachmentsEnabled: boolean;
  emailSenderCustomizationEnabled: boolean;
  smsRemindersEnabled: boolean;
};

export const DEFAULT_PLAN: Plan = {
  allowedPhotoMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxPhotoBytes: 10_485_760, // 10 MB
  maxPhotosPerEvent: 50,
  maxVideosPerEvent: 50,
  maxMediaBytesPerAccount: 5_368_709_120, // 5 GB ops backstop, not a conversion lever
  presignExpirySeconds: 900, // 15 minutes
  renditionVariants: ['thumb', 'grid', 'lightbox'],
  maxSeriesPerOrganizer: 1,
  maxEventsPerSeries: 50,
  maxEventCapacity: 50,
  assistantsPerSeries: 1,
  customBrandingEnabled: false,
  customDomainEnabled: false,
  analyticsTier: 'basic',
  dataExportEnabled: false,
  bulkMediaDownloadEnabled: false,
  calendarInviteAttachmentsEnabled: false,
  emailSenderCustomizationEnabled: false,
  smsRemindersEnabled: false,
};

/** Numeric values that ops may need to tune without a code change come from config. */
export function planForConfig(overrides: { mediaPresignExpirySeconds?: number } = {}): Plan {
  return {
    ...DEFAULT_PLAN,
    presignExpirySeconds: overrides.mediaPresignExpirySeconds ?? DEFAULT_PLAN.presignExpirySeconds,
  };
}

export function assertMimeAllowed(plan: Plan, mimeType: string): void {
  if (!plan.allowedPhotoMimeTypes.includes(mimeType)) {
    throw new MediaUploadInvalidError(
      `Unsupported photo type "${mimeType}". Allowed types: ${plan.allowedPhotoMimeTypes.join(', ')}.`,
    );
  }
}

export function assertSizeAllowed(plan: Plan, sizeBytes: number): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1) {
    throw new MediaUploadInvalidError('size_bytes must be a positive integer.');
  }
  if (sizeBytes > plan.maxPhotoBytes) {
    throw new MediaUploadInvalidError(`Photos may be at most ${plan.maxPhotoBytes} bytes (10 MB).`);
  }
}

export function assertEventPhotoQuota(plan: Plan, currentCount: number): void {
  if (currentCount >= plan.maxPhotosPerEvent) {
    throw new MediaQuotaExceededError('event', `This event already has the maximum of ${plan.maxPhotosPerEvent} photos.`);
  }
}

export function assertEventVideoQuota(plan: Plan, currentCount: number): void {
  if (currentCount >= plan.maxVideosPerEvent) {
    throw new MediaQuotaExceededError('event', `This event already has the maximum of ${plan.maxVideosPerEvent} videos.`);
  }
}

export function assertAccountByteQuota(plan: Plan, currentBytes: number, additionalBytes: number): void {
  if (currentBytes + additionalBytes > plan.maxMediaBytesPerAccount) {
    throw new MediaQuotaExceededError('account', 'The account media storage limit (5 GB) would be exceeded.');
  }
}

export function assertSeriesQuota(plan: Plan, currentCount: number): void {
  if (currentCount >= plan.maxSeriesPerOrganizer) {
    throw new PlanLimitExceededError('series', `The current plan allows ${plan.maxSeriesPerOrganizer} open-mic series per organizer.`);
  }
}

export function assertEventCountQuota(plan: Plan, currentCount: number): void {
  if (currentCount >= plan.maxEventsPerSeries) {
    throw new PlanLimitExceededError('event', `This series already has the maximum of ${plan.maxEventsPerSeries} events.`);
  }
}

export function assertEventCapacityAllowed(plan: Plan, capacity: number | null | undefined): void {
  // The default plan rejects both unlimited capacity (null/omitted) and values above
  // max_event_capacity. This caps only what the organizer can configure — it does NOT
  // change the Milestone 2 rule that kiosk sign-ups are exempt from event capacity.
  if (capacity === null || capacity === undefined || capacity > plan.maxEventCapacity) {
    throw new PlanLimitExceededError(
      'event_capacity',
      `The current plan requires an event capacity of at most ${plan.maxEventCapacity}.`,
    );
  }
}
