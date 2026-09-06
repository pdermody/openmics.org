exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations
      ADD COLUMN song_names text[] NOT NULL DEFAULT '{}';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations DROP COLUMN IF EXISTS song_names;
  `);
};
