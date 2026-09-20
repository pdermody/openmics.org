exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations
      ADD COLUMN bio text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations DROP COLUMN IF EXISTS bio;
  `);
};
