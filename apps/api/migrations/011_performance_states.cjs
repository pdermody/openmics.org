// Expands the performance lifecycle beyond registered/performed/no_show/cancelled so the
// organizer roster can track a performer through the door (present), the running order
// (scheduled), the stage (performing), and back off it (performed). Each transition is
// automatically timestamped server-side (see performances/repository.ts); these columns are
// never client-writable.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE performances
      DROP CONSTRAINT performances_status_check,
      ADD CONSTRAINT performances_status_check
        CHECK (status IN ('registered', 'present', 'scheduled', 'performing', 'performed', 'no_show', 'cancelled')),
      ADD COLUMN checked_in_at timestamptz,
      ADD COLUMN scheduled_at timestamptz,
      ADD COLUMN started_at timestamptz,
      ADD COLUMN finished_at timestamptz;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE performances
      DROP COLUMN IF EXISTS finished_at,
      DROP COLUMN IF EXISTS started_at,
      DROP COLUMN IF EXISTS scheduled_at,
      DROP COLUMN IF EXISTS checked_in_at,
      DROP CONSTRAINT performances_status_check,
      ADD CONSTRAINT performances_status_check CHECK (status IN ('registered', 'performed', 'no_show', 'cancelled'));
  `);
};
