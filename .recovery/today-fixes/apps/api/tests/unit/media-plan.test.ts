import { describe, expect, it } from 'vitest';

import {
  assertAccountByteQuota,
  assertEventCapacityAllowed,
  assertEventCountQuota,
  assertEventPhotoQuota,
  assertEventVideoQuota,
  assertMimeAllowed,
  assertSeriesQuota,
  assertSizeAllowed,
  DEFAULT_PLAN,
  planForConfig,
} from '../../src/media/plan.js';

describe('media plan guards (decisions.md → DEFAULT_PLAN)', () => {
  it('allows only the photo MIME allowlist', () => {
    expect(() => assertMimeAllowed(DEFAULT_PLAN, 'image/jpeg')).not.toThrow();
    expect(() => assertMimeAllowed(DEFAULT_PLAN, 'image/png')).not.toThrow();
    expect(() => assertMimeAllowed(DEFAULT_PLAN, 'image/webp')).not.toThrow();
    for (const rejected of ['image/heic', 'image/avif', 'image/gif', 'video/mp4', 'application/octet-stream']) {
      expect(() => assertMimeAllowed(DEFAULT_PLAN, rejected)).toThrowError(expect.objectContaining({ code: 'MEDIA_UPLOAD_INVALID' }));
    }
  });

  it('caps photo size at 10 MB', () => {
    expect(() => assertSizeAllowed(DEFAULT_PLAN, 10_485_760)).not.toThrow();
    expect(() => assertSizeAllowed(DEFAULT_PLAN, 10_485_761)).toThrowError(expect.objectContaining({ code: 'MEDIA_UPLOAD_INVALID' }));
    expect(() => assertSizeAllowed(DEFAULT_PLAN, 0)).toThrowError(expect.objectContaining({ code: 'MEDIA_UPLOAD_INVALID' }));
  });

  it('enforces the per-event photo/video count caps with scope=event', () => {
    expect(() => assertEventPhotoQuota(DEFAULT_PLAN, 49)).not.toThrow();
    expect(() => assertEventPhotoQuota(DEFAULT_PLAN, 50)).toThrowError(
      expect.objectContaining({ code: 'MEDIA_QUOTA_EXCEEDED', details: { scope: 'event' } }),
    );
    expect(() => assertEventVideoQuota(DEFAULT_PLAN, 50)).toThrowError(
      expect.objectContaining({ code: 'MEDIA_QUOTA_EXCEEDED', details: { scope: 'event' } }),
    );
  });

  it('enforces the per-account byte backstop with scope=account', () => {
    expect(() => assertAccountByteQuota(DEFAULT_PLAN, 5_368_709_120, 1)).toThrowError(
      expect.objectContaining({ code: 'MEDIA_QUOTA_EXCEEDED', details: { scope: 'account' } }),
    );
    expect(() => assertAccountByteQuota(DEFAULT_PLAN, 5_368_709_120 - 10, 10)).not.toThrow();
  });

  it('enforces the capacity caps with PLAN_LIMIT_EXCEEDED scopes', () => {
    expect(() => assertSeriesQuota(DEFAULT_PLAN, 0)).not.toThrow();
    expect(() => assertSeriesQuota(DEFAULT_PLAN, 1)).toThrowError(
      expect.objectContaining({ code: 'PLAN_LIMIT_EXCEEDED', statusCode: 403, details: { scope: 'series' } }),
    );
    expect(() => assertEventCountQuota(DEFAULT_PLAN, 49)).not.toThrow();
    expect(() => assertEventCountQuota(DEFAULT_PLAN, 50)).toThrowError(
      expect.objectContaining({ code: 'PLAN_LIMIT_EXCEEDED', details: { scope: 'event' } }),
    );
  });

  it('rejects unlimited and over-50 event capacity', () => {
    expect(() => assertEventCapacityAllowed(DEFAULT_PLAN, 50)).not.toThrow();
    expect(() => assertEventCapacityAllowed(DEFAULT_PLAN, 1)).not.toThrow();
    expect(() => assertEventCapacityAllowed(DEFAULT_PLAN, 51)).toThrowError(
      expect.objectContaining({ code: 'PLAN_LIMIT_EXCEEDED', details: { scope: 'event_capacity' } }),
    );
    expect(() => assertEventCapacityAllowed(DEFAULT_PLAN, null)).toThrowError(expect.objectContaining({ code: 'PLAN_LIMIT_EXCEEDED' }));
    expect(() => assertEventCapacityAllowed(DEFAULT_PLAN, undefined)).toThrowError(expect.objectContaining({ code: 'PLAN_LIMIT_EXCEEDED' }));
  });

  it('keeps the reserved conversion-lever fields on the plan shape (not enforced)', () => {
    expect(DEFAULT_PLAN).toMatchObject({
      assistantsPerSeries: 1,
      customBrandingEnabled: false,
      customDomainEnabled: false,
      analyticsTier: 'basic',
      dataExportEnabled: false,
      bulkMediaDownloadEnabled: false,
      calendarInviteAttachmentsEnabled: false,
      emailSenderCustomizationEnabled: false,
      smsRemindersEnabled: false,
    });
    // No AV scanning flag on the plan shape (decisions.md: disabled, deferred).
    expect(DEFAULT_PLAN).not.toHaveProperty('avScanEnabled');
    expect(DEFAULT_PLAN.renditionVariants).toEqual(['thumb', 'grid', 'lightbox']);
  });

  it('drives the presign expiry from config', () => {
    expect(planForConfig({ mediaPresignExpirySeconds: 300 }).presignExpirySeconds).toBe(300);
    expect(planForConfig().presignExpirySeconds).toBe(900);
  });
});
