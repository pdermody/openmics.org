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

export class HandleConflictError extends AppError {
  constructor(
    public readonly holderType: 'profile' | 'open_mic' | null,
    public readonly holderId: string | null,
  ) {
    super(409, 'HANDLE_UNAVAILABLE', 'Handle unavailable');
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
