import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type RegistrationRow = {
  id: string;
  event_id: string;
  profile_id: string | null;
  performer_name: string;
  performer_city: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  song_names: string[];
  bio: string | null;
  submission_channel: string;
  organizer_supervised: boolean;
  referred_by_profile_id: string | null;
  media_consent: boolean;
  media_consent_updated_at: Date | null;
  edit_token_hash: string | null;
  edit_token_expires_at: Date | null;
  email_verification_token_hash: string | null;
  email_verification_token_expires_at: Date | null;
  verification_method: string | null;
  email_verified_at: Date | null;
  claimed_by_account_id: string | null;
  claimed_at: Date | null;
  adopted_profile_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by_profile_id: string | null;
  recovery_deadline: Date | null;
};

export type InsertRegistrationInput = {
  eventId: string;
  profileId?: string | null;
  performerName: string;
  performerCity?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  songNames?: string[];
  bio?: string | null;
  submissionChannel: string;
  organizerSupervised: boolean;
  referredByProfileId?: string | null;
  mediaConsent?: boolean;
  editTokenHash?: string | null;
  editTokenExpiresAt?: Date | null;
  emailVerificationTokenHash?: string | null;
  emailVerificationTokenExpiresAt?: Date | null;
  verificationMethod?: string | null;
  emailVerifiedAt?: Date | null;
};

export async function insertRegistration(client: PoolClient, input: InsertRegistrationInput): Promise<RegistrationRow> {
  const result = await client.query<RegistrationRow>(
    `INSERT INTO registrations (
      event_id, profile_id, performer_name, performer_city, contact_email, contact_phone, song_names,
      bio, submission_channel, organizer_supervised, referred_by_profile_id, media_consent,
      edit_token_hash, edit_token_expires_at, email_verification_token_hash,
      email_verification_token_expires_at, verification_method, email_verified_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, COALESCE($7, '{}'::text[]), $8, $9, $10, $11, COALESCE($12, true),
      $13, $14, $15, $16, $17, $18
    ) RETURNING *`,
    [
      input.eventId,
      input.profileId ?? null,
      input.performerName,
      input.performerCity ?? null,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.songNames ?? null,
      input.bio ?? null,
      input.submissionChannel,
      input.organizerSupervised,
      input.referredByProfileId ?? null,
      input.mediaConsent ?? null,
      input.editTokenHash ?? null,
      input.editTokenExpiresAt ?? null,
      input.emailVerificationTokenHash ?? null,
      input.emailVerificationTokenExpiresAt ?? null,
      input.verificationMethod ?? null,
      input.emailVerifiedAt ?? null,
    ],
  );
  return result.rows[0];
}

export async function findRegistrationById(client: Queryable, id: string): Promise<RegistrationRow | null> {
  const result = await client.query<RegistrationRow>(
    'SELECT * FROM registrations WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findRegistrationByToken(
  client: Queryable,
  column: 'edit_token_hash' | 'email_verification_token_hash',
  tokenHash: string,
): Promise<RegistrationRow | null> {
  const result = await client.query<RegistrationRow>(
    `SELECT * FROM registrations WHERE ${column} = $1 AND deleted_at IS NULL`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function findRegistrationsByEventId(client: Queryable, eventId: string): Promise<RegistrationRow[]> {
  const result = await client.query<RegistrationRow>(
    'SELECT * FROM registrations WHERE event_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
    [eventId],
  );
  return result.rows;
}

export async function findClaimableRegistrations(client: Queryable, email: string): Promise<RegistrationRow[]> {
  const result = await client.query<RegistrationRow>(
    `SELECT * FROM registrations
     WHERE deleted_at IS NULL AND claimed_by_account_id IS NULL
       AND email_verified_at IS NOT NULL AND lower(contact_email) = lower($1)
     ORDER BY created_at ASC`,
    [email],
  );
  return result.rows;
}

export async function findRegistrationsByProfileId(client: Queryable, profileId: string): Promise<RegistrationRow[]> {
  const result = await client.query<RegistrationRow>(
    'SELECT * FROM registrations WHERE profile_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
    [profileId],
  );
  return result.rows;
}

export async function updateRegistration(
  pool: Pool,
  id: string,
  changes: Partial<Record<string, unknown>>,
): Promise<RegistrationRow | null> {
  const allowed = new Set([
    'performer_name', 'performer_city', 'contact_email', 'contact_phone', 'song_names', 'bio', 'media_consent', 'adopted_profile_id',
    'claimed_by_account_id', 'claimed_at', 'verification_method', 'email_verified_at',
    'email_verification_token_hash', 'email_verification_token_expires_at',
  ]);
  const clauses: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  for (const [column, value] of Object.entries(changes)) {
    if (!allowed.has(column)) continue;
    clauses.push(`${column} = $${index++}`);
    values.push(value);
    if (column === 'media_consent') clauses.push(`media_consent_updated_at = now()`);
  }
  if (clauses.length === 0) return findRegistrationById(pool, id);

  clauses.push('updated_at = now()');
  values.push(id);
  const result = await pool.query<RegistrationRow>(
    `UPDATE registrations SET ${clauses.join(', ')} WHERE id = $${index} AND deleted_at IS NULL RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

// Mirrors softDeleteEvent/softDeletePerformance: a 30-day recovery window, consistent with the
// rest of the platform's soft-delete model (docs/architecture/data-model.md). Also cascades to
// soft-delete every one of this registration's still-active performances in the same call — a
// deleted registration must never leave a live, visible performance behind (e.g. still sitting in
// the Scheduled queue, blocking topOfScheduled/nextSequenceForColumn from ever seeing past it).
// Callers passing a `PoolClient` already inside their own transaction get both updates atomically
// for free; callers passing the bare `Pool` get two independent statements (acceptable here since
// the registration row is what actually matters for visibility, and this is the only writer of
// registrations.deleted_at).
export async function softDeleteRegistration(pool: Queryable, id: string, deletedByProfileId: string): Promise<RegistrationRow | null> {
  const result = await pool.query<RegistrationRow>(
    `UPDATE registrations
     SET deleted_at = now(), deleted_by_profile_id = $1, recovery_deadline = now() + interval '30 days', updated_at = now()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [deletedByProfileId, id],
  );
  const registration = result.rows[0] ?? null;
  if (registration) {
    await pool.query(
      `UPDATE performances
       SET deleted_at = now(), deleted_by_profile_id = $1, recovery_deadline = now() + interval '30 days', updated_at = now()
       WHERE registration_id = $2 AND deleted_at IS NULL`,
      [deletedByProfileId, id],
    );
  }
  return registration;
}

export function serializeRegistration(row: RegistrationRow) {
  return {
    id: row.id,
    event_id: row.event_id,
    profile_id: row.profile_id,
    performer_name: row.performer_name,
    performer_city: row.performer_city,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    song_names: row.song_names ?? [],
    bio: row.bio,
    submission_channel: row.submission_channel,
    organizer_supervised: row.organizer_supervised,
    referred_by_profile_id: row.referred_by_profile_id,
    media_consent: row.media_consent,
    media_consent_updated_at: row.media_consent_updated_at,
    email_verified_at: row.email_verified_at,
    verification_method: row.verification_method,
    visibility_state: row.email_verified_at ? 'valid' : 'pending',
    claimed_by_account_id: row.claimed_by_account_id,
    claimed_at: row.claimed_at,
    adopted_profile_id: row.adopted_profile_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
