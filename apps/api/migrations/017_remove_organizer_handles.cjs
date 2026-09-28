// One-time exception to the redirect/quarantine policy: organizer handles are freed immediately
// (see docs/decisions.md "Profile kinds and handles").
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE profiles SET current_handle = NULL
    WHERE profile_kind = 'organizer' AND current_handle IS NOT NULL;

    DELETE FROM handles
    WHERE entity_type = 'profile'
      AND profile_id IN (SELECT id FROM profiles WHERE profile_kind = 'organizer');
  `);
};

// Deleted handles cannot be meaningfully restored.
exports.down = () => {};
