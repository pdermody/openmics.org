// Profile-owner display toggle for the derived gig-media gallery on performer profile
// pages (media-gallery-design.md §10.3). Display-only: it does not hide media from
// event or series galleries and is not a substitute for registration media_consent.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE profiles
      ADD COLUMN show_gig_media boolean NOT NULL DEFAULT true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE profiles DROP COLUMN IF EXISTS show_gig_media;
  `);
};
