import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export interface EventRow {
  id: string;
  open_mic_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  time_zone: string;
  running: boolean | null;
  registrations_closed_at: string | null;
  venue_name: string;
  address_line1: string;
  address_line2: string | null;
  postcode: string | null;
  city: string;
  country: string;
  lat: string | null;
  lng: string | null;
  activities: string[] | null;
  tags: string[];
  capacity: string | null;
  notes: string | null;
  entry_fee_amount: string | null;
  entry_fee_currency: string | null;
  entry_fee_note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by_profile_id: string | null;
  recovery_deadline: string | null;
}

export interface InsertEventInput {
  openMicId: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  timeZone: string;
  running?: boolean | null;
  registrationsClosedAt?: string | null;
  venueName?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  postcode?: string | null;
  city?: string;
  country?: string;
  lat?: number | null;
  lng?: number | null;
  activities?: string[] | null;
  tags?: string[];
  capacity?: number | null;
  notes?: string | null;
  entryFeeAmount?: number | null;
  entryFeeCurrency?: string | null;
  entryFeeNote?: string | null;
}

export async function insertEvent(client: PoolClient, input: InsertEventInput): Promise<EventRow> {
  const result = await client.query<EventRow>(
    `INSERT INTO events (
      open_mic_id, title, starts_at, ends_at, time_zone, running, registrations_closed_at,
      venue_name, address_line1, address_line2, postcode, city, country, lat, lng,
      activities, tags, capacity, notes, entry_fee_amount, entry_fee_currency, entry_fee_note
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13, $14, $15,
      $16, COALESCE($17, '{}'::text[]), $18, $19, $20, $21, $22
    ) RETURNING *`,
    [
      input.openMicId,
      input.title,
      input.startsAt,
      input.endsAt ?? null,
      input.timeZone,
      input.running ?? null,
      input.registrationsClosedAt ?? null,
      input.venueName ?? null,
      input.addressLine1 ?? null,
      input.addressLine2 ?? null,
      input.postcode ?? null,
      input.city ?? null,
      input.country ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.activities ?? null,
      input.tags,
      input.capacity ?? null,
      input.notes ?? null,
      input.entryFeeAmount ?? null,
      input.entryFeeCurrency ?? null,
      input.entryFeeNote ?? null,
    ],
  );

  return result.rows[0];
}

export async function findEventById(client: Queryable, id: string): Promise<EventRow | null> {
  const result = await client.query<EventRow>('SELECT * FROM events WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] ?? null;
}

export async function findEventsByOpenMicId(client: Queryable, openMicId: string): Promise<EventRow[]> {
  const result = await client.query<EventRow>(
    'SELECT * FROM events WHERE open_mic_id = $1 AND deleted_at IS NULL ORDER BY starts_at ASC',
    [openMicId],
  );
  return result.rows;
}

export async function findUpcomingEvents(
  client: Queryable,
  options: { from?: string; to?: string; limit: number; geo?: { lat: number; lng: number; radiusKm: number } },
): Promise<EventRow[]> {
  const values: unknown[] = [];
  const conditions = ['e.deleted_at IS NULL', "o.deleted_at IS NULL", "o.status NOT IN ('draft', 'ended')", 'e.starts_at >= now()'];
  if (options.from) {
    values.push(options.from);
    conditions.push(`e.starts_at >= $${values.length}`);
  }
  if (options.to) {
    values.push(options.to);
    conditions.push(`e.starts_at <= $${values.length}`);
  }
  if (options.geo) {
    values.push(options.geo.lng, options.geo.lat, options.geo.radiusKm * 1000);
    conditions.push(`ST_DWithin(e.location, ST_SetSRID(ST_MakePoint($${values.length - 2}, $${values.length - 1}), 4326)::geography, $${values.length})`);
  }
  values.push(options.limit);
  const result = await client.query<EventRow>(
    `SELECT e.* FROM events e JOIN open_mics o ON o.id = e.open_mic_id
     WHERE ${conditions.join(' AND ')} ORDER BY e.starts_at ASC LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

export async function findNextEventByOpenMicId(client: Queryable, openMicId: string): Promise<EventRow | null> {
  const result = await client.query<EventRow>(
    `SELECT * FROM events
     WHERE open_mic_id = $1 AND deleted_at IS NULL AND starts_at >= now()
       AND (registrations_closed_at IS NULL OR registrations_closed_at > now())
     ORDER BY starts_at ASC LIMIT 1`,
    [openMicId],
  );
  return result.rows[0] ?? null;
}

export async function updateEvent(pool: Pool, id: string, changes: Partial<InsertEventInput>): Promise<EventRow | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const fieldMapping: Record<keyof InsertEventInput, string> = {
    title: 'title',
    startsAt: 'starts_at',
    endsAt: 'ends_at',
    timeZone: 'time_zone',
    running: 'running',
    registrationsClosedAt: 'registrations_closed_at',
    venueName: 'venue_name',
    addressLine1: 'address_line1',
    addressLine2: 'address_line2',
    postcode: 'postcode',
    city: 'city',
    country: 'country',
    lat: 'lat',
    lng: 'lng',
    activities: 'activities',
    tags: 'tags',
    capacity: 'capacity',
    notes: 'notes',
    entryFeeAmount: 'entry_fee_amount',
    entryFeeCurrency: 'entry_fee_currency',
    entryFeeNote: 'entry_fee_note',
    openMicId: 'open_mic_id',
  };

  for (const [key, dbCol] of Object.entries(fieldMapping)) {
    if (key in changes && changes[key as keyof InsertEventInput] !== undefined) {
      const value = changes[key as keyof InsertEventInput];
      // Handle tags specially — ensure it's always an array
      if (key === 'tags') {
        updates.push(`${dbCol} = COALESCE($${paramIndex}::text[], '{}'::text[])`);
      } else {
        updates.push(`${dbCol} = $${paramIndex}`);
      }
      values.push(value ?? null);
      paramIndex += 1;
    }
  }

  if (updates.length === 0) {
    return findEventById(pool, id);
  }

  updates.push(`updated_at = now()`);
  values.push(id);

  const result = await pool.query<EventRow>(
    `UPDATE events SET ${updates.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL RETURNING *`,
    values,
  );

  return result.rows[0] ?? null;
}

export function serializeEvent(row: EventRow): Record<string, unknown> {
  return {
    id: row.id,
    open_mic_id: row.open_mic_id,
    title: row.title,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    time_zone: row.time_zone,
    running: row.running,
    registrations_closed_at: row.registrations_closed_at,
    venue_name: row.venue_name,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    postcode: row.postcode,
    city: row.city,
    country: row.country,
    lat: row.lat ? Number(row.lat) : null,
    lng: row.lng ? Number(row.lng) : null,
    activities: row.activities,
    tags: row.tags,
    capacity: row.capacity ? Number(row.capacity) : null,
    notes: row.notes,
    entry_fee_amount: row.entry_fee_amount ? Number(row.entry_fee_amount) : null,
    entry_fee_currency: row.entry_fee_currency,
    entry_fee_note: row.entry_fee_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
