exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations
      DROP CONSTRAINT registrations_channel_check,
      ADD CONSTRAINT registrations_channel_check CHECK (submission_channel IN ('organic', 'shared_link', 'email_reminder', 'social_ad', 'poster_qr', 'kiosk', 'kiosk_qr', 'prior')),
      DROP CONSTRAINT registrations_verification_check,
      ADD CONSTRAINT registrations_verification_check CHECK (verification_method IS NULL OR verification_method IN ('email', 'organizer_kiosk', 'kiosk_qr', 'authenticated_account')),
      DROP CONSTRAINT registrations_contact_check,
      ADD CONSTRAINT registrations_contact_check CHECK (organizer_supervised OR submission_channel = 'kiosk_qr' OR profile_id IS NOT NULL OR contact_email IS NOT NULL);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE registrations
      DROP CONSTRAINT registrations_channel_check,
      ADD CONSTRAINT registrations_channel_check CHECK (submission_channel IN ('organic', 'shared_link', 'email_reminder', 'social_ad', 'poster_qr', 'kiosk', 'prior')),
      DROP CONSTRAINT registrations_verification_check,
      ADD CONSTRAINT registrations_verification_check CHECK (verification_method IS NULL OR verification_method IN ('email', 'organizer_kiosk', 'authenticated_account')),
      DROP CONSTRAINT registrations_contact_check,
      ADD CONSTRAINT registrations_contact_check CHECK (organizer_supervised OR profile_id IS NOT NULL OR contact_email IS NOT NULL);
  `);
};
