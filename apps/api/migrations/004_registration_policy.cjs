exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations
      ADD COLUMN media_consent_updated_at timestamptz;

    CREATE UNIQUE INDEX registrations_event_verified_email_uq
      ON registrations (event_id, lower(contact_email))
      WHERE deleted_at IS NULL AND email_verified_at IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS registrations_event_verified_email_uq;
    ALTER TABLE registrations DROP COLUMN IF EXISTS media_consent_updated_at;
  `);
};
