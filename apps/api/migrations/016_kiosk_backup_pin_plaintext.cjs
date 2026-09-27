exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE open_mics
      DROP COLUMN kiosk_backup_pin_hash,
      ADD COLUMN kiosk_backup_pin text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE open_mics
      DROP COLUMN IF EXISTS kiosk_backup_pin,
      ADD COLUMN kiosk_backup_pin_hash text;
  `);
};