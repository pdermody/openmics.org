import type { FastifyInstance, FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../errors.js';
import type { AuthenticatedAccount, AuthVerifier } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    account?: AuthenticatedAccount;
  }
}

function extractBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

export function registerAuth(app: FastifyInstance, verify: AuthVerifier): void {
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedError();

    const account = await verify(token);
    if (!account) throw new UnauthorizedError();

    request.account = account;
  });
}
