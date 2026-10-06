import type { Pool, PoolClient } from 'pg';

export type OpenMicRow = {
  id: string;
  public_code: string;
  owner_profile_id: string;
  current_handle: string | null;
  name: string;
  description: string | null;
  activities: string[];
  tags: string[];
  venue_name: string;
  address_line1: string;
  address_line2: string | null;
  postcode: string | null;
  city: string;
  city_id: string | null;
  country: string;
  lat: string | null;
  lng: string | null;
  time_zone: string;
  website: string | null;
  contact_email: string | null;
  schedule_summary: string | null;
  schedule_details: string | null;
  originals_only: boolean;
  amplification_available: boolean;
  age_policy: string;
  registration_mode: string;
  external_registration_url: string | null;
  entry_fee_amount: string;
  entry_fee_currency: string | null;
  entry_fee_note: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  recovery_deadline: Date | null;
  // Never included in serializeOpenMic's output. Read/write only through owner-authenticated
  // kiosk-backup-pin routes; the PIN is not an account-security credential.
  kiosk_backup_pin: string | null;
  distance_km?: string | number | null;
};

type Queryable = Pool | PoolClient;

/** Non-soft-deleted series count for the plan's per-organizer series cap. */
export async function countOwnedOpenMics(client: Queryable, ownerProfileId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM open_mics WHERE owner_profile_id = $1 AND deleted_at IS NULL',
    [ownerProfileId],
  );
  return Number(result.rows[0].count);
}

export type InsertOpenMicInput = {
  ownerProfileId: string;
  name: string;
  description?: string;
  activities: string[];
  tags?: string[];
  venueName: string;
  addressLine1: string;
  addressLine2?: string;
  postcode?: string;
  city: string;
  cityId?: string | null;
  country: string;
  lat?: number;
  lng?: number;
  timeZone: string;
  website?: string;
  contactEmail?: string;
  scheduleSummary?: string;
  scheduleDetails?: string;
  originalsOnly?: boolean;
  amplificationAvailable?: boolean;
  agePolicy?: string;
  registrationMode?: string;
  externalRegistrationUrl?: string;
  entryFeeAmount?: number;
  entryFeeCurrency?: string;
  entryFeeNote?: string;
};

export async function insertOpenMic(client: PoolClient, input: InsertOpenMicInput): Promise<OpenMicRow> {
  const result = await client.query<OpenMicRow>(
    `INSERT INTO open_mics (
       owner_profile_id, name, description, activities, tags, venue_name, address_line1, address_line2,
       postcode, city, country, city_id, lat, lng, time_zone, website, contact_email, schedule_summary, schedule_details,
       originals_only, amplification_available, age_policy, registration_mode, external_registration_url,
       entry_fee_amount, entry_fee_currency, entry_fee_note
     ) VALUES (
       $1, $2, $3, $4, COALESCE($5, '{}'::text[]), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, COALESCE($20, false), COALESCE($21, false), COALESCE($22, 'both'),
       COALESCE($23, 'both'), $24, COALESCE($25, 0), $26, $27
     ) RETURNING *`,
    [
      input.ownerProfileId,
      input.name,
      input.description ?? null,
      input.activities,
      input.tags ?? null,
      input.venueName,
      input.addressLine1,
      input.addressLine2 ?? null,
      input.postcode ?? null,
      input.city,
      input.country,
      input.cityId ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.timeZone,
      input.website ?? null,
      input.contactEmail ?? null,
      input.scheduleSummary ?? null,
      input.scheduleDetails ?? null,
      input.originalsOnly ?? null,
      input.amplificationAvailable ?? null,
      input.agePolicy ?? null,
      input.registrationMode ?? null,
      input.externalRegistrationUrl ?? null,
      input.entryFeeAmount ?? null,
      input.entryFeeCurrency ?? null,
      input.entryFeeNote ?? null,
    ],
  );
  return result.rows[0];
}

export async function findOpenMicById(client: Queryable, id: string): Promise<OpenMicRow | null> {
  const result = await client.query<OpenMicRow>('SELECT * FROM open_mics WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] ?? null;
}

export async function findOpenMicByIdOrPublicCode(client: Queryable, identifier: string): Promise<OpenMicRow | null> {
  const result = await client.query<OpenMicRow>(
    'SELECT * FROM open_mics WHERE (id::text = $1 OR public_code = upper($1) OR lower(current_handle) = lower($1)) AND deleted_at IS NULL',
    [identifier],
  );
  return result.rows[0] ?? null;
}

export async function findPublicOpenMics(
  client: Queryable,
  options: { limit: number; offset: number; q?: string; country?: string; city?: string; activity?: string; tag?: string; registrationMode?: string; ownerProfileId?: string; geo?: { lat: number; lng: number; radiusKm: number } },
): Promise<{ rows: OpenMicRow[]; total: number }> {
  const values: unknown[] = [];
  const conditions = ["deleted_at IS NULL", "status = 'active'"];
  let geoPointParameters: { lng: number; lat: number } | undefined;
  if (options.q) {
    values.push(`%${options.q}%`);
    conditions.push(`(name ILIKE $${values.length} OR description ILIKE $${values.length})`);
  }
  if (options.country) {
    values.push(options.country);
    conditions.push(`lower(country) = lower($${values.length})`);
  }
  if (options.city) {
    values.push(options.city);
    conditions.push(`lower(city) = lower($${values.length})`);
  }
  if (options.activity) {
    values.push(options.activity);
    conditions.push(`$${values.length} = ANY(activities)`);
  }
  if (options.tag) {
    values.push(options.tag);
    conditions.push(`$${values.length} = ANY(tags)`);
  }
  if (options.registrationMode) {
    values.push(options.registrationMode);
    conditions.push(`registration_mode = $${values.length}`);
  }
  if (options.ownerProfileId) {
    values.push(options.ownerProfileId);
    conditions.push(`owner_profile_id = $${values.length}`);
  }
  if (options.geo) {
    geoPointParameters = { lng: values.length + 1, lat: values.length + 2 };
    values.push(options.geo.lng, options.geo.lat, options.geo.radiusKm * 1000);
    conditions.push(`ST_DWithin(location, ST_SetSRID(ST_MakePoint($${values.length - 2}, $${values.length - 1}), 4326)::geography, $${values.length})`);
  }
  const where = conditions.join(' AND ');
  values.push(options.limit, options.offset);
  const distanceSelect = geoPointParameters
    ? `, ST_Distance(location, ST_SetSRID(ST_MakePoint($${geoPointParameters.lng}, $${geoPointParameters.lat}), 4326)::geography) / 1000.0 AS distance_km`
    : '';
  const result = await client.query<OpenMicRow>(
    `SELECT *${distanceSelect}
     FROM open_mics
     WHERE ${where}
     ORDER BY ${options.geo ? 'distance_km ASC, id ASC' : 'name ASC, id ASC'} LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const count = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM open_mics
     WHERE ${where}`,
    values.slice(0, -2),
  );
  return { rows: result.rows, total: Number(count.rows[0].count) };
}

export async function findOwnedOpenMics(pool: Pool, ownerProfileId: string): Promise<OpenMicRow[]> {  // Unlike findPublicOpenMics (the public directory search, which always excludes
  // draft/ended per docs/architecture/api-design.md), an organizer must see every
  // series they own regardless of status so a newly-created draft series is visible
  // on their own dashboard immediately after creation.
  const result = await pool.query<OpenMicRow>(
    'SELECT * FROM open_mics WHERE owner_profile_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
    [ownerProfileId],
  );
  return result.rows;
}

const UPDATABLE_COLUMNS = [
  'name',
  'description',
  'activities',
  'tags',
  'venue_name',
  'address_line1',
  'address_line2',
  'postcode',
  'city',
  'country',
  'city_id',
  'lat',
  'lng',
  'time_zone',
  'website',
  'contact_email',
  'schedule_summary',
  'schedule_details',
  'originals_only',
  'amplification_available',
  'age_policy',
  'registration_mode',
  'external_registration_url',
  'entry_fee_amount',
  'entry_fee_currency',
  'entry_fee_note',
  'status',
] as const;

export async function updateOpenMic(
  pool: Pool,
  id: string,
  changes: Partial<Record<(typeof UPDATABLE_COLUMNS)[number], unknown>>,
): Promise<OpenMicRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const column of UPDATABLE_COLUMNS) {
    if (changes[column] === undefined) continue;
    setClauses.push(`${column} = $${paramIndex++}`);
    values.push(changes[column]);
  }

  if (setClauses.length === 0) return findOpenMicById(pool, id);

  setClauses.push('updated_at = now()');
  values.push(id);

  const result = await pool.query<OpenMicRow>(
    `UPDATE open_mics SET ${setClauses.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function softDeleteOpenMic(pool: Pool, id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE open_mics
     SET deleted_at = now(), recovery_deadline = now() + interval '30 days', updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id],
  );
  return result.rowCount === 1;
}

// Per-series (not per-device) so the fallback works from any device/browser that runs this
// series' kiosk, and survives clearing browser storage.
export async function getKioskBackupPin(pool: Pool, id: string): Promise<string | null> {
  const result = await pool.query<{ kiosk_backup_pin: string | null }>(
    'SELECT kiosk_backup_pin FROM open_mics WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0]?.kiosk_backup_pin ?? null;
}

export async function setKioskBackupPin(pool: Pool, id: string, pin: string): Promise<void> {
  await pool.query('UPDATE open_mics SET kiosk_backup_pin = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL', [pin, id]);
}

export function serializeOpenMic(row: OpenMicRow) {
  return {
    id: row.id,
    public_code: row.public_code,
    owner_profile_id: row.owner_profile_id,
    current_handle: row.current_handle,
    name: row.name,
    description: row.description,
    activities: row.activities,
    tags: row.tags,
    venue_name: row.venue_name,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    postcode: row.postcode,
    city: row.city,
    city_id: row.city_id ?? null,
    country: row.country,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    time_zone: row.time_zone,
    website: row.website,
    contact_email: row.contact_email,
    schedule_summary: row.schedule_summary,
    schedule_details: row.schedule_details,
    originals_only: row.originals_only,
    amplification_available: row.amplification_available,
    age_policy: row.age_policy,
    registration_mode: row.registration_mode,
    external_registration_url: row.external_registration_url,
    entry_fee_amount: Number(row.entry_fee_amount),
    entry_fee_currency: row.entry_fee_currency,
    entry_fee_note: row.entry_fee_note,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.distance_km === undefined ? {} : { distance_km: Number(row.distance_km) }),
  };
}
