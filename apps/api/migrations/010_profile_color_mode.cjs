exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE profiles
      ADD COLUMN color_mode text,
      ADD CONSTRAINT profiles_color_mode_check CHECK (color_mode IN ('light', 'dark'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE profiles DROP COLUMN IF EXISTS color_mode;
  `);
};
