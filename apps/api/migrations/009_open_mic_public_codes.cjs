exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE open_mics
      ADD COLUMN public_code text NOT NULL DEFAULT upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));

    CREATE UNIQUE INDEX open_mics_public_code_uq ON open_mics (public_code);
    ALTER TABLE open_mics
      ADD CONSTRAINT open_mics_public_code_format_check CHECK (public_code ~ '^[A-Z0-9]{10}$');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE open_mics DROP CONSTRAINT IF EXISTS open_mics_public_code_format_check;
    DROP INDEX IF EXISTS open_mics_public_code_uq;
    ALTER TABLE open_mics DROP COLUMN IF EXISTS public_code;
  `);
};
