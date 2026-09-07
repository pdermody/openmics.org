exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE events
      ADD COLUMN public_code text NOT NULL DEFAULT upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));

    CREATE UNIQUE INDEX events_public_code_uq ON events (public_code);
    ALTER TABLE events
      ADD CONSTRAINT events_public_code_format_check CHECK (public_code ~ '^[A-Z0-9]{10}$');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_public_code_format_check;
    DROP INDEX IF EXISTS events_public_code_uq;
    ALTER TABLE events DROP COLUMN IF EXISTS public_code;
  `);
};
