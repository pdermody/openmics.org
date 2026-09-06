import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { ForbiddenError, ValidationError } from '../errors.js';
import { findProfileById } from './repository.js';

// The "current profile" mechanism from docs/5-open-mic-frontend-architecture.md:
// profile-scoped creates act on behalf of whichever profile the client selects
// via X-Current-Profile, not the account itself.
export async function requireOwnedProfile(pool: Pool, request: FastifyRequest, options: { profileKind: string }) {
  const header = request.headers['x-current-profile'];
  const profileId = Array.isArray(header) ? header[0] : header;
  if (!profileId) {
    throw new ValidationError('X-Current-Profile header is required', { field: 'x-current-profile' });
  }

  const profile = await findProfileById(pool, profileId);
  if (!profile) {
    throw new ValidationError('X-Current-Profile does not reference an existing profile', {
      field: 'x-current-profile',
    });
  }

  const account = request.account!;
  if (profile.created_by_account_id !== account.accountId && !account.isPlatformAdmin) {
    throw new ForbiddenError('You do not own the profile specified in X-Current-Profile');
  }

  if (profile.profile_kind !== options.profileKind) {
    throw new ValidationError(`X-Current-Profile must reference a ${options.profileKind} profile`, {
      field: 'x-current-profile',
    });
  }

  return profile;
}
