exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cognito_id text NOT NULL UNIQUE,
      email text NOT NULL UNIQUE,
      display_name text,
      city text,
      preferred_language text,
      current_profile_id uuid,
      is_platform_admin boolean NOT NULL DEFAULT false,
      plan text NOT NULL DEFAULT 'free',
      referred_by_profile_id uuid,
      referred_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT accounts_plan_check CHECK (plan IN ('free', 'pro')),
      CONSTRAINT accounts_referral_check CHECK ((referred_by_profile_id IS NULL) = (referred_at IS NULL))
    );

    CREATE TABLE profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by_account_id uuid NOT NULL REFERENCES accounts(id),
      current_handle text,
      profile_name text NOT NULL,
      profile_kind text NOT NULL,
      bio text,
      profile_image_url text,
      theme_name text,
      visibility text NOT NULL DEFAULT 'public',
      is_locked boolean NOT NULL DEFAULT false,
      is_hidden boolean NOT NULL DEFAULT false,
      is_blacklisted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      deleted_by_profile_id uuid,
      recovery_deadline timestamptz,
      CONSTRAINT profiles_kind_check CHECK (profile_kind IN ('organizer', 'performer')),
      CONSTRAINT profiles_visibility_check CHECK (visibility IN ('public', 'unlisted', 'private'))
    );

    ALTER TABLE accounts
      ADD CONSTRAINT accounts_current_profile_fk
      FOREIGN KEY (current_profile_id) REFERENCES profiles(id) ON DELETE SET NULL,
      ADD CONSTRAINT accounts_referrer_fk
      FOREIGN KEY (referred_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

    CREATE TABLE handles (
      handle text PRIMARY KEY,
      entity_type text,
      profile_id uuid REFERENCES profiles(id) ON DELETE RESTRICT,
      open_mic_id uuid,
      status text NOT NULL,
      redirects_to_handle text,
      redirect_expires_at timestamptz,
      quarantine_expires_at timestamptz,
      reserved_category text,
      reserved_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      retired_at timestamptz,
      created_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      created_by_admin_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
      CONSTRAINT handles_entity_type_check CHECK (entity_type IN ('profile', 'open_mic') OR entity_type IS NULL),
      CONSTRAINT handles_status_check CHECK (status IN ('current', 'redirect', 'quarantined', 'reserved', 'available', 'tombstoned')),
      CONSTRAINT handles_entity_arc_check CHECK (
        (entity_type = 'profile' AND profile_id IS NOT NULL AND open_mic_id IS NULL)
        OR (entity_type = 'open_mic' AND profile_id IS NULL AND open_mic_id IS NOT NULL)
        OR (entity_type IS NULL AND profile_id IS NULL AND open_mic_id IS NULL)
      ),
      CONSTRAINT handles_status_fields_check CHECK (
        (status = 'current' AND redirects_to_handle IS NULL AND entity_type IS NOT NULL)
        OR (status = 'redirect' AND redirects_to_handle IS NOT NULL AND entity_type IS NOT NULL AND redirect_expires_at IS NOT NULL)
        OR (status = 'quarantined' AND entity_type IS NOT NULL AND redirects_to_handle IS NOT NULL AND quarantine_expires_at IS NOT NULL)
        OR (status IN ('reserved', 'available', 'tombstoned') AND entity_type IS NULL AND redirects_to_handle IS NULL)
      ),
      CONSTRAINT handles_reserved_fields_check CHECK (
        (reserved_category IS NULL AND reserved_reason IS NULL) OR status = 'reserved'
      )
    );

    CREATE UNIQUE INDEX handles_lower_handle_uq ON handles (lower(handle));
    CREATE INDEX handles_current_profile_idx ON handles (profile_id) WHERE status = 'current' AND profile_id IS NOT NULL;
    CREATE INDEX handles_current_open_mic_idx ON handles (open_mic_id) WHERE status = 'current' AND open_mic_id IS NOT NULL;
    CREATE INDEX handles_reserved_idx ON handles (status) WHERE status = 'reserved';

    ALTER TABLE profiles
      ADD CONSTRAINT profiles_current_handle_fk
      FOREIGN KEY (current_handle) REFERENCES handles(handle) ON UPDATE CASCADE,
      ADD CONSTRAINT profiles_deleted_by_fk
      FOREIGN KEY (deleted_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

    CREATE TABLE open_mics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_profile_id uuid NOT NULL REFERENCES profiles(id),
      current_handle text,
      name text NOT NULL,
      description text,
      activities text[] NOT NULL,
      tags text[] NOT NULL DEFAULT '{}',
      venue_name text NOT NULL,
      address_line1 text NOT NULL,
      address_line2 text,
      postcode text,
      city text NOT NULL,
      country text NOT NULL,
      lat numeric(9, 6),
      lng numeric(9, 6),
      time_zone text NOT NULL,
      location geography(Point, 4326) GENERATED ALWAYS AS (
        CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
        END
      ) STORED,
      website text,
      contact_email text,
      schedule_summary text,
      schedule_details text,
      originals_only boolean NOT NULL DEFAULT false,
      amplification_available boolean NOT NULL DEFAULT false,
      age_policy text NOT NULL DEFAULT 'both',
      registration_mode text NOT NULL DEFAULT 'both',
      external_registration_url text,
      entry_fee_amount numeric(10, 2) NOT NULL DEFAULT 0,
      entry_fee_currency text,
      entry_fee_note text,
      status text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      deleted_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      recovery_deadline timestamptz,
      CONSTRAINT open_mics_activities_check CHECK (activities <@ ARRAY['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other']::text[]),
      CONSTRAINT open_mics_activities_nonempty_check CHECK (cardinality(activities) >= 1),
      CONSTRAINT open_mics_coordinates_check CHECK ((lat IS NULL) = (lng IS NULL)),
      CONSTRAINT open_mics_age_policy_check CHECK (age_policy IN ('adults_only', 'children_only', 'both')),
      CONSTRAINT open_mics_registration_mode_check CHECK (registration_mode IN ('pre_only', 'on_night_only', 'both', 'external')),
      CONSTRAINT open_mics_external_registration_check CHECK (registration_mode <> 'external' OR external_registration_url IS NOT NULL),
      CONSTRAINT open_mics_entry_fee_check CHECK (entry_fee_amount >= 0 AND (entry_fee_amount = 0 OR entry_fee_currency IS NOT NULL)),
      CONSTRAINT open_mics_status_check CHECK (status IN ('active', 'paused', 'ended', 'draft'))
    );

    ALTER TABLE handles
      ADD CONSTRAINT handles_open_mic_fk
      FOREIGN KEY (open_mic_id) REFERENCES open_mics(id) ON DELETE RESTRICT;

    ALTER TABLE open_mics
      ADD CONSTRAINT open_mics_current_handle_fk
      FOREIGN KEY (current_handle) REFERENCES handles(handle) ON UPDATE CASCADE,
      ADD CONSTRAINT open_mics_owner_kind_fk
      CHECK (owner_profile_id IS NOT NULL);

    CREATE INDEX open_mics_owner_idx ON open_mics (owner_profile_id);
    CREATE INDEX open_mics_location_gist_idx ON open_mics USING gist (location);
    CREATE INDEX open_mics_activities_gin_idx ON open_mics USING gin (activities);
    CREATE INDEX open_mics_tags_gin_idx ON open_mics USING gin (tags);

    CREATE TABLE events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      open_mic_id uuid NOT NULL REFERENCES open_mics(id),
      title text NOT NULL,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz,
      time_zone text NOT NULL,
      running boolean,
      registrations_closed_at timestamptz,
      venue_name text NOT NULL,
      address_line1 text NOT NULL,
      address_line2 text,
      postcode text,
      city text NOT NULL,
      country text NOT NULL,
      lat numeric(9, 6),
      lng numeric(9, 6),
      location geography(Point, 4326) GENERATED ALWAYS AS (
        CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
        END
      ) STORED,
      activities text[],
      tags text[] NOT NULL DEFAULT '{}',
      capacity integer,
      entry_fee_amount numeric(10, 2),
      entry_fee_currency text,
      entry_fee_note text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      deleted_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      recovery_deadline timestamptz,
      CONSTRAINT events_time_check CHECK (ends_at IS NULL OR ends_at > starts_at),
      CONSTRAINT events_coordinates_check CHECK ((lat IS NULL) = (lng IS NULL)),
      CONSTRAINT events_capacity_check CHECK (capacity IS NULL OR capacity > 0),
      CONSTRAINT events_activities_check CHECK (activities IS NULL OR activities <@ ARRAY['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other']::text[]),
      CONSTRAINT events_entry_fee_check CHECK (entry_fee_amount IS NULL OR (entry_fee_amount >= 0 AND (entry_fee_amount = 0 OR entry_fee_currency IS NOT NULL)))
    );

    CREATE INDEX events_open_mic_starts_idx ON events (open_mic_id, starts_at);
    CREATE INDEX events_location_gist_idx ON events USING gist (location);
    CREATE INDEX events_activities_gin_idx ON events USING gin (activities);
    CREATE INDEX events_tags_gin_idx ON events USING gin (tags);

    CREATE TABLE registrations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES events(id),
      profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      performer_name text NOT NULL,
      performer_city text,
      contact_email text,
      contact_phone text,
      submission_channel text NOT NULL DEFAULT 'organic',
      organizer_supervised boolean NOT NULL DEFAULT false,
      referred_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      media_consent boolean NOT NULL DEFAULT true,
      edit_token_hash text UNIQUE,
      edit_token_expires_at timestamptz,
      email_verification_token_hash text UNIQUE,
      email_verification_token_expires_at timestamptz,
      verification_method text,
      email_verified_at timestamptz,
      claimed_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
      claimed_at timestamptz,
      adopted_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      deleted_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      recovery_deadline timestamptz,
      CONSTRAINT registrations_channel_check CHECK (submission_channel IN ('organic', 'shared_link', 'email_reminder', 'social_ad', 'poster_qr', 'kiosk', 'prior')),
      CONSTRAINT registrations_kiosk_check CHECK (NOT organizer_supervised OR submission_channel = 'kiosk'),
      CONSTRAINT registrations_contact_check CHECK (organizer_supervised OR profile_id IS NOT NULL OR contact_email IS NOT NULL),
      CONSTRAINT registrations_claim_check CHECK ((claimed_by_account_id IS NULL) = (claimed_at IS NULL)),
      CONSTRAINT registrations_adoption_check CHECK (adopted_profile_id IS NULL OR claimed_by_account_id IS NOT NULL),
      CONSTRAINT registrations_verification_check CHECK (verification_method IS NULL OR verification_method IN ('email', 'organizer_kiosk', 'authenticated_account')),
      CONSTRAINT registrations_verified_state_check CHECK (email_verified_at IS NULL OR verification_method IS NOT NULL)
    );

    CREATE UNIQUE INDEX registrations_event_profile_uq ON registrations (event_id, profile_id) WHERE deleted_at IS NULL AND profile_id IS NOT NULL;
    CREATE INDEX registrations_event_idx ON registrations (event_id, created_at);
    CREATE INDEX registrations_contact_email_idx ON registrations (lower(contact_email)) WHERE contact_email IS NOT NULL AND claimed_by_account_id IS NULL;
    CREATE INDEX registrations_claimed_account_idx ON registrations (claimed_by_account_id) WHERE claimed_by_account_id IS NOT NULL;

    CREATE TABLE performances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
      name text NOT NULL,
      activity text,
      sequence integer NOT NULL DEFAULT 1,
      status text NOT NULL DEFAULT 'registered',
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT performances_sequence_check CHECK (sequence > 0),
      CONSTRAINT performances_status_check CHECK (status IN ('registered', 'performed', 'no_show', 'cancelled')),
      CONSTRAINT performances_activity_check CHECK (activity IS NULL OR activity IN ('singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other'))
    );

    CREATE INDEX performances_registration_idx ON performances (registration_id, sequence);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS performances;
    DROP TABLE IF EXISTS registrations;
    DROP TABLE IF EXISTS events;
    DROP TABLE IF EXISTS open_mics;
    DROP TABLE IF EXISTS handles;
    DROP TABLE IF EXISTS profiles;
    DROP TABLE IF EXISTS accounts;
  `);
};