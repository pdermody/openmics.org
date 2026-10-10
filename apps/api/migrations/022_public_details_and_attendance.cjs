exports.up = (pgm) => {
  pgm.addColumns('open_mics', { public_information: { type: 'text' } });
  pgm.addColumns('events', {
    public_information: { type: 'text' },
    audience_guest_count: { type: 'integer', check: 'audience_guest_count >= 0' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('events', ['public_information', 'audience_guest_count']);
  pgm.dropColumns('open_mics', ['public_information']);
};
