exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE profiles
      ADD COLUMN phone text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE profiles DROP COLUMN IF EXISTS phone;
  `);
};
