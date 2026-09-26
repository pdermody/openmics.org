// Replaces the manual event running flag with explicit publication. Event phase is derived
// from starts_at/ends_at in application code; legacy draft rows may retain a null end time.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE events
      ADD COLUMN status text NOT NULL DEFAULT 'draft',
      ADD CONSTRAINT events_status_check CHECK (status IN ('draft', 'published'));

    UPDATE events AS event
    SET status = 'published'
    FROM open_mics AS open_mic
    WHERE event.open_mic_id = open_mic.id
      AND event.ends_at IS NOT NULL
      AND open_mic.status = 'active';

    ALTER TABLE events DROP COLUMN running;

    CREATE INDEX events_public_starts_idx
      ON events (starts_at)
      WHERE deleted_at IS NULL AND status = 'published';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS events_public_starts_idx;

    ALTER TABLE events
      ADD COLUMN running boolean,
      DROP CONSTRAINT events_status_check,
      DROP COLUMN status;
  `);
};