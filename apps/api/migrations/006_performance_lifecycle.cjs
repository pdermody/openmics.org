exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE performances
      ADD COLUMN deleted_at timestamptz,
      ADD COLUMN deleted_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      ADD COLUMN recovery_deadline timestamptz;

    CREATE INDEX performances_active_registration_idx
      ON performances (registration_id, sequence)
      WHERE deleted_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS performances_active_registration_idx;
    ALTER TABLE performances
      DROP COLUMN IF EXISTS recovery_deadline,
      DROP COLUMN IF EXISTS deleted_by_profile_id,
      DROP COLUMN IF EXISTS deleted_at;
  `);
};
