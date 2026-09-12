exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE open_mics
      ADD COLUMN kiosk_backup_pin_hash text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE open_mics DROP COLUMN IF EXISTS kiosk_backup_pin_hash;
  `);
};
