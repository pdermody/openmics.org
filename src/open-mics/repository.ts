import type { Pool, PoolClient } from 'pg';

export type OpenMicRow = {
  id: string;
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
};

type Queryable = Pool | PoolClient;

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
       postcode, city, country, lat, lng, time_zone, website, contact_email, schedule_summary, schedule_details,
       originals_only, amplification_available, age_policy, registration_mode, external_registration_url,
       entry_fee_amount, entry_fee_currency, entry_fee_note
     ) VALUES (
       $1, $2, $3, $4, COALESCE($5, '{}'::text[]), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       COALESCE($19, false), COALESCE($20, false), COALESCE($21, 'both'), COALESCE($22, 'both'), $23,
       COALESCE($24, 0), $25, $26
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

export function serializeOpenMic(row: OpenMicRow) {
  return {
    id: row.id,
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
  };
}
