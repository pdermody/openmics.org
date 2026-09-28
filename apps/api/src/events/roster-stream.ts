import { SignJWT, jwtVerify } from 'jose';
import type { Pool } from 'pg';

// Short-lived (5 minute), single-purpose token for the roster SSE stream: EventSource cannot
// send an Authorization header, so the client exchanges its bearer token for one of these via
// POST /events/{id}/roster/stream-token, then passes it as a query parameter on the stream
// itself. See decisions.md → Live updates for the full contract.
const STREAM_TOKEN_TTL_SECONDS = 5 * 60;
// Kiosk tokens without an event end still need a bounded lifetime.
const KIOSK_TOKEN_FALLBACK_TTL_MS = 12 * 60 * 60 * 1000;

// Both token kinds share a secret and carry event_id, so each verifier must check the purpose.
type TokenPurpose = 'roster_stream' | 'kiosk_registration';

export type StreamTokenClaims = { eventId: string };

async function signEventToken(secret: string, eventId: string, purpose: TokenPurpose, expiresAt: Date): Promise<string> {
  return new SignJWT({ event_id: eventId, purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(secret));
}

async function verifyEventToken(secret: string, token: string, purpose: TokenPurpose): Promise<StreamTokenClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
  if (typeof payload.event_id !== 'string' || payload.purpose !== purpose) throw new Error('Invalid token');
  return { eventId: payload.event_id };
}

export async function signStreamToken(secret: string, eventId: string): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + STREAM_TOKEN_TTL_SECONDS * 1000);
  return { token: await signEventToken(secret, eventId, 'roster_stream', expiresAt), expiresAt };
}

export async function verifyStreamToken(secret: string, token: string): Promise<StreamTokenClaims> {
  return verifyEventToken(secret, token, 'roster_stream');
}

export async function signKioskRegistrationToken(
  secret: string,
  event: { id: string; starts_at: Date | string; ends_at: Date | string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = event.ends_at
    ? new Date(event.ends_at)
    : new Date(new Date(event.starts_at).getTime() + KIOSK_TOKEN_FALLBACK_TTL_MS);
  return { token: await signEventToken(secret, event.id, 'kiosk_registration', expiresAt), expiresAt };
}

export async function verifyKioskRegistrationToken(secret: string, token: string): Promise<StreamTokenClaims> {
  return verifyEventToken(secret, token, 'kiosk_registration');
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
  | 'registration.deleted'
  | 'performance.created'
  | 'performance.updated'
  | 'performance.deleted'
  | 'performance.reordered'
  | 'event.updated';

export async function notifyRoster(pool: Pool, eventId: string, eventName: RosterEventName, data: Record<string, unknown> = {}): Promise<void> {
  const payload = JSON.stringify({ event: eventName, ...data });
  await pool.query('SELECT pg_notify($1, $2)', [rosterChannelName(eventId), payload]);
}
