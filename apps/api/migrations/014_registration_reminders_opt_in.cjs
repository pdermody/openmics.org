exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations
      ADD COLUMN reminders_opt_in boolean NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations DROP COLUMN IF EXISTS reminders_opt_in;
  `);
};
