import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL ?? 'postgres://openmic:openmic_local@127.0.0.1:5432/openmic_dev';
const databaseName = new URL(connectionString).pathname.slice(1);

if (databaseName !== 'openmic_dev') {
  throw new Error(`Refusing to seed database "${databaseName}". This script only accepts openmic_dev.`);
}

const pool = new Pool({ connectionString });

try {
  await pool.query('BEGIN');
  await pool.query(`
    TRUNCATE performances, registrations, events, open_mics, handles, profiles, accounts
    RESTART IDENTITY CASCADE
  `);

  const owner = await pool.query(
    `INSERT INTO accounts (cognito_id, email, display_name, city)
     VALUES ('dev-owner', 'owner@openmic.test', 'Mara Quinn', 'Dublin') RETURNING id`,
  );
  const performer = await pool.query(
    `INSERT INTO accounts (cognito_id, email, display_name, city)
     VALUES ('dev-performer', 'performer@openmic.test', 'Noah Reed', 'Dublin') RETURNING id`,
  );
  const organizerTwo = await pool.query(
    `INSERT INTO accounts (cognito_id, email, display_name, city)
     VALUES ('dev-organizer-2', 'organizer-2@openmic.test', 'Rosa Byrne', 'Cork') RETURNING id`,
  );
  const performerTwo = await pool.query(
    `INSERT INTO accounts (cognito_id, email, display_name, city)
     VALUES ('dev-performer-2', 'performer-2@openmic.test', 'Iona Park', 'Galway') RETURNING id`,
  );
  const privateAccount = await pool.query(
    `INSERT INTO accounts (cognito_id, email, display_name)
     VALUES ('dev-private', 'private@openmic.test', 'Private Demo') RETURNING id`,
  );

  const organizer = await pool.query(
    `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, bio, visibility)
     VALUES ($1, 'Mara Quinn', 'organizer', 'Host, songwriter, and keeper of welcoming rooms.', 'public') RETURNING id`,
    [owner.rows[0].id],
  );
  const organizerTwoProfile = await pool.query(
    `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, bio, visibility)
     VALUES ($1, 'Rosa Byrne', 'organizer', 'A careful host for brave first sets and slow burners.', 'public') RETURNING id`,
    [organizerTwo.rows[0].id],
  );
  const ownerPerformer = await pool.query(
    `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, bio, phone, visibility)
     VALUES ($1, 'Mara on Stage', 'performer', 'Acoustic covers, original songs, and a little spoken word.', '+353 87 555 0102', 'public') RETURNING id`,
    [owner.rows[0].id],
  );
  const performerProfile = await pool.query(
    `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, bio, visibility)
     VALUES ($1, 'Noah Reed', 'performer', 'Acoustic songs and small stories.', 'public') RETURNING id`,
    [performer.rows[0].id],
  );
  const performerTwoProfile = await pool.query(
    `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, bio, visibility)
     VALUES ($1, 'Iona Park', 'performer', 'Soft rock, harmonies, and bright introspective songs.', 'public') RETURNING id`,
    [performerTwo.rows[0].id],
  );
  const privateProfile = await pool.query(
    `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, visibility, is_hidden)
     VALUES ($1, 'Private Demo Profile', 'performer', 'private', false) RETURNING id`,
    [privateAccount.rows[0].id],
  );

  const houseLights = await pool.query(
    `INSERT INTO open_mics (
      owner_profile_id, name, description, activities, tags, venue_name, address_line1, city, country,
      lat, lng, time_zone, schedule_summary, age_policy, registration_mode, status
    ) VALUES (
      $1, 'The Lantern Sessions', 'A small room for generous listening and new work.',
      ARRAY['singing', 'poetry'], ARRAY['welcoming', 'all-levels'], 'The Lantern', '14 Thomas Street',
      'Dublin', 'IE', 53.3438, -6.2775, 'Europe/Dublin', 'Every Tuesday at 19:30', 'both', 'both', 'active'
    ) RETURNING id`,
    [organizer.rows[0].id],
  );
  const blueNote = await pool.query(
    `INSERT INTO open_mics (
      owner_profile_id, name, description, activities, tags, venue_name, address_line1, city, country,
      lat, lng, time_zone, schedule_summary, age_policy, registration_mode, status
    ) VALUES (
      $1, 'Blue Note Sundays', 'A relaxed Sunday showcase for music and spoken word.',
      ARRAY['singing', 'storytelling'], ARRAY['sunday', 'music'], 'The Blue Note', '8 Crown Alley',
      'Dublin', 'IE', 53.3467, -6.2667, 'Europe/Dublin', 'First Sunday of each month', 'both', 'pre_only', 'paused'
    ) RETURNING id`,
    [organizer.rows[0].id],
  );
  await pool.query(
    `INSERT INTO open_mics (
      owner_profile_id, name, description, activities, venue_name, address_line1, city, country,
      time_zone, age_policy, registration_mode, status
    ) VALUES ($1, 'Draft Room', 'Not publicly listed.', ARRAY['singing'], 'Draft Venue', '1 Draft Lane', 'Dublin', 'IE', 'Europe/Dublin', 'both', 'both', 'draft')`,
    [organizer.rows[0].id],
  );

  await pool.query(
    `INSERT INTO handles (handle, entity_type, profile_id, status) VALUES
      ('Mara-Quinn', 'profile', $1, 'current'),
      ('Rosa-Byrne', 'profile', $2, 'current'),
      ('Mara-on-Stage', 'profile', $3, 'current'),
      ('Noah-Reed', 'profile', $4, 'current'),
      ('Iona-Park', 'profile', $5, 'current')`,
    [organizer.rows[0].id, organizerTwoProfile.rows[0].id, ownerPerformer.rows[0].id, performerProfile.rows[0].id, performerTwoProfile.rows[0].id],
  );
  await pool.query(
    `INSERT INTO handles (handle, entity_type, open_mic_id, status) VALUES
      ('Lantern-Sessions', 'open_mic', $1, 'current'),
      ('Blue-Note-Sundays', 'open_mic', $2, 'current')`,
    [houseLights.rows[0].id, blueNote.rows[0].id],
  );
  await pool.query(
    `UPDATE profiles SET current_handle = CASE id WHEN $1 THEN 'Mara-Quinn' WHEN $2 THEN 'Rosa-Byrne' WHEN $3 THEN 'Mara-on-Stage' WHEN $4 THEN 'Noah-Reed' WHEN $5 THEN 'Iona-Park' END
     WHERE id IN ($1, $2, $3, $4, $5)`,
    [organizer.rows[0].id, organizerTwoProfile.rows[0].id, ownerPerformer.rows[0].id, performerProfile.rows[0].id, performerTwoProfile.rows[0].id],
  );
  await pool.query(
    `UPDATE accounts SET current_profile_id = $1 WHERE id = $2`,
    [organizer.rows[0].id, owner.rows[0].id],
  );
  await pool.query(
    `UPDATE accounts SET current_profile_id = $1 WHERE id = $2`,
    [organizerTwoProfile.rows[0].id, organizerTwo.rows[0].id],
  );
  await pool.query(
    `UPDATE accounts SET current_profile_id = $1 WHERE id = $2`,
    [performerProfile.rows[0].id, performer.rows[0].id],
  );
  await pool.query(
    `UPDATE accounts SET current_profile_id = $1 WHERE id = $2`,
    [performerTwoProfile.rows[0].id, performerTwo.rows[0].id],
  );
  await pool.query(
    `UPDATE open_mics SET current_handle = CASE id WHEN $1 THEN 'Lantern-Sessions' WHEN $2 THEN 'Blue-Note-Sundays' END
     WHERE id IN ($1, $2)`,
    [houseLights.rows[0].id, blueNote.rows[0].id],
  );

  const event = await pool.query(
    `INSERT INTO events (
      open_mic_id, title, starts_at, ends_at, time_zone, venue_name, address_line1, city, country,
      lat, lng, activities, tags, capacity, notes
    ) VALUES (
      $1, 'Tuesday at The Lantern', now() + interval '3 days', now() + interval '3 days 3 hours',
      'Europe/Dublin', 'The Lantern', '14 Thomas Street', 'Dublin', 'IE', 53.3438, -6.2775,
      ARRAY['singing', 'poetry'], ARRAY['featured'], 12, 'Doors at 19:00. Sign-up closes when the list is full.'
    ) RETURNING id`,
    [houseLights.rows[0].id],
  );
  await pool.query(
    `INSERT INTO events (
      open_mic_id, title, starts_at, registrations_closed_at, time_zone, venue_name, address_line1, city, country,
      lat, lng, activities, capacity
    ) VALUES (
      $1, 'Last Tuesday at The Lantern', now() + interval '1 day', now() - interval '1 hour',
      'Europe/Dublin', 'The Lantern', '14 Thomas Street', 'Dublin', 'IE', 53.3438, -6.2775,
      ARRAY['singing'], 20
    )`,
    [houseLights.rows[0].id],
  );
  await pool.query(
    `INSERT INTO events (open_mic_id, title, starts_at, time_zone, venue_name, address_line1, city, country, activities)
     VALUES ($1, 'Blue Note Showcase', now() + interval '12 days', 'Europe/Dublin', 'The Blue Note', '8 Crown Alley', 'Dublin', 'IE', ARRAY['singing', 'storytelling'])`,
    [blueNote.rows[0].id],
  );

  const verifiedRegistration = await pool.query(
    `INSERT INTO registrations (
      event_id, profile_id, performer_name, contact_email, song_names, submission_channel,
      organizer_supervised, media_consent, verification_method, email_verified_at
    ) VALUES ($1, $2, 'Noah Reed', 'performer@openmic.test', ARRAY['North Star'], 'organic', false, true, 'authenticated_account', now()) RETURNING id`,
    [event.rows[0].id, performerProfile.rows[0].id],
  );
  await pool.query(
    `INSERT INTO registrations (
      event_id, performer_name, performer_city, contact_email, song_names, submission_channel,
      organizer_supervised, media_consent
    ) VALUES ($1, 'Pending Guest', 'Dublin', 'pending@openmic.test', ARRAY['First Light'], 'shared_link', false, true)`,
    [event.rows[0].id],
  );
  await pool.query(
    `INSERT INTO performances (registration_id, name, activity, sequence, status, notes)
     VALUES ($1, 'North Star', 'singing', 1, 'registered', 'Bring a capo')`,
    [verifiedRegistration.rows[0].id],
  );

  await pool.query('COMMIT');
  console.log('Seeded openmic_dev with frontend development data.');
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await pool.end();
}
