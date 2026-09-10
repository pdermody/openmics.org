import { SignJWT, jwtVerify } from 'jose';
import type { Pool } from 'pg';

// Short-lived (5 minute), single-purpose token for the roster SSE stream: EventSource cannot
// send an Authorization header, so the client exchanges its bearer token for one of these via
// POST /events/{id}/roster/stream-token, then passes it as a query parameter on the stream
// itself. See decisions.md → Live updates for the full contract.
const STREAM_TOKEN_TTL_SECONDS = 5 * 60;

export type StreamTokenClaims = { eventId: string };

export async function signStreamToken(secret: string, eventId: string): Promise<{ token: string; expiresAt: Date }> {
  const key = new TextEncoder().encode(secret);
  const expiresAt = new Date(Date.now() + STREAM_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({ event_id: eventId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key);
  return { token, expiresAt };
}

export async function verifyStreamToken(secret: string, token: string): Promise<StreamTokenClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  if (typeof payload.event_id !== 'string') throw new Error('Invalid stream token');
  return { eventId: payload.event_id };
}

// NOTIFY/LISTEN channel names must be valid unquoted SQL identifiers to keep the LISTEN/UNLISTEN
// statements (which don't support query parameters) injection-safe; stripping the UUID's hyphens
// keeps the channel alphanumeric while remaining unique per event.
export function rosterChannelName(eventId: string): string {
  return `roster_${eventId.replace(/-/g, '')}`;
}

export type RosterEventName =
  | 'registration.created'
  | 'registration.updated'
  | 'performance.created'
  | 'performance.updated'
  | 'performance.deleted'
  | 'performance.reordered';

export async function notifyRoster(pool: Pool, eventId: string, eventName: RosterEventName, data: Record<string, unknown> = {}): Promise<void> {
  const payload = JSON.stringify({ event: eventName, ...data });
  await pool.query('SELECT pg_notify($1, $2)', [rosterChannelName(eventId), payload]);
}
