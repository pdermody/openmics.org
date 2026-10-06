import type { FastifyInstance } from 'fastify';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied') {
    super(403, 'FORBIDDEN', message);
  }
}

export class ConflictError extends AppError {
  constructor(code = 'CONFLICT', message = 'The request conflicts with the current resource state') {
    super(409, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class GoneError extends AppError {
  constructor(message = 'Resource is no longer available') {
    super(410, 'GONE', message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Please try again shortly.') {
    super(429, 'GEOCODING_RATE_LIMITED', message);
  }
}

export class GeocodingUnavailableError extends AppError {
  constructor(message = 'Geocoding is not configured on this server.') {
    super(503, 'GEOCODING_UNAVAILABLE', message);
  }
}

export class CityCatalogueImportRequiredError extends AppError {
  constructor(sourceIds: string[]) {
    super(
      503,
      'CITY_CATALOGUE_IMPORT_REQUIRED',
      'The city catalogue is not synchronized with the database. Run the explicit city catalogue import.',
      {
        action: 'npm run db:import:cities',
        missing_count: sourceIds.length,
        missing_source_ids: sourceIds.slice(0, 10),
      },
    );
  }
}

export class HandleConflictError extends AppError {
  constructor(
    public readonly holderType: 'profile' | 'open_mic' | null,
    public readonly holderId: string | null,
  ) {
    super(409, 'HANDLE_UNAVAILABLE', 'Handle unavailable');
  }
}

// Media pipeline errors (openapi.yaml → Media responses). `scope` discriminators ride in
// `details` so clients can tell event quotas from account backstops / plan caps apart.
export type MediaQuotaScope = 'event' | 'account';
export type PlanLimitScope = 'series' | 'event' | 'event_capacity';

export class MediaUploadInvalidError extends AppError {
  constructor(message = 'The upload does not meet the plan rules') {
    super(400, 'MEDIA_UPLOAD_INVALID', message);
  }
}

export class MediaSourcePolicyError extends AppError {
  constructor(message = 'Media source is not allowed') {
    super(400, 'MEDIA_SOURCE_POLICY', message);
  }
}

export class MediaQuotaExceededError extends AppError {
  constructor(scope: MediaQuotaScope, message = 'Media quota exceeded') {
    super(409, 'MEDIA_QUOTA_EXCEEDED', message, { scope });
  }
}

export class MediaConsentRevokedError extends AppError {
  constructor(message = 'The linked registration has revoked media consent') {
    super(409, 'MEDIA_CONSENT_REVOKED', message);
  }
}

export class MediaNotFoundError extends AppError {
  constructor(message = 'Media not found') {
    super(404, 'MEDIA_NOT_FOUND', message);
  }
}

export class MediaHiddenError extends AppError {
  constructor(message = 'Media is not available', details?: { event_id: string | null; open_mic_id: string | null }) {
    super(404, 'MEDIA_HIDDEN', message, details);
  }
}

export class MediaFeaturedInvalidError extends AppError {
  constructor(message = 'Featured list references media that cannot be pinned') {
    super(400, 'MEDIA_FEATURED_INVALID', message);
  }
}

export class MediaRecoveryExpiredError extends AppError {
  constructor(message = 'The recovery window for this media has elapsed') {
    super(410, 'MEDIA_RECOVERY_EXPIRED', message);
  }
}

export class PlanLimitExceededError extends AppError {
  constructor(scope: PlanLimitScope, message = 'The current plan does not allow this') {
    super(403, 'PLAN_LIMIT_EXCEEDED', message, { scope });
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HandleConflictError) {
      reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message }, holder_type: err.holderType, holder_id: err.holderId });
      return;
    }

    if (err instanceof AppError) {
      const body: { error: { code: string; message: string; details?: unknown } } = {
        error: { code: err.code, message: err.message },
      };
      if (err.details !== undefined) body.error.details = err.details;
      reply.status(err.statusCode).send(body);
      return;
    }

    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (statusCode < 500) {
      reply.status(statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } });
      return;
    }

    request.log.error(err);
    reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
}
