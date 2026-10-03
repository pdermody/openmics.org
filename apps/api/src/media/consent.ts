import type { PoolClient } from 'pg';

import { enqueueMediaDeletions } from './objects.js';
import {
  cancelPendingDeletionsForMedia,
  removeFeaturedPinsForMedia,
  restoreConsentRevokedMedia,
  softDeleteMediaForConsentRevocation,
} from './repository.js';

// Retroactive media-consent semantics (decisions.md → Guest Registrations; design §10.1).
// Revocation soft-deletes every visible media row linked to the registration (reason
// 'consent_revocation'), drops their Featured pins, and queues their bytes for purge at
// the recovery deadline. Restoration inside the window reverses only those rows —
// organizer-deleted media stays deleted. Wired into PATCH /registrations/{id} (which
// also stamps media_consent_updated_at) by registrations/routes.ts.
export type MediaConsentHooks = {
  applyRevocation(client: PoolClient, registrationId: string): Promise<void>;
  applyRestoration(client: PoolClient, registrationId: string): Promise<void>;
};

export function createMediaConsentHooks(options: { bucket: string; cdnBaseUrl: string }): MediaConsentHooks {
  return {
    async applyRevocation(client, registrationId) {
      const affected = await softDeleteMediaForConsentRevocation(client, registrationId);
      for (const media of affected) {
        await enqueueMediaDeletions(client, media, {
          bucket: options.bucket,
          cdnBaseUrl: options.cdnBaseUrl,
          reason: 'purge',
        });
      }
      await removeFeaturedPinsForMedia(client, affected.map((media) => media.id));
    },

    async applyRestoration(client, registrationId) {
      const restored = await restoreConsentRevokedMedia(client, registrationId);
      for (const media of restored) {
        await cancelPendingDeletionsForMedia(client, media.id);
      }
    },
  };
}
