exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE cities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source text NOT NULL,
      source_id text NOT NULL,
      city text NOT NULL,
      city_ascii text NOT NULL,
      country text NOT NULL,
      country_ascii text NOT NULL,
      iso2 text NOT NULL,
      iso3 text,
      admin_name text,
      lat numeric(9, 6) NOT NULL,
      lng numeric(9, 6) NOT NULL,
      centre geography(Point, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      ) STORED,
      population bigint,
      source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      retired boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cities_source_identity_unique UNIQUE (source, source_id),
      CONSTRAINT cities_iso2_check CHECK (iso2 ~ '^[A-Z]{2}$'),
      CONSTRAINT cities_iso3_check CHECK (iso3 IS NULL OR iso3 ~ '^[A-Z]{3}$'),
      CONSTRAINT cities_lat_check CHECK (lat BETWEEN -90 AND 90),
      CONSTRAINT cities_lng_check CHECK (lng BETWEEN -180 AND 180),
      CONSTRAINT cities_population_check CHECK (population IS NULL OR population >= 0)
    );
    CREATE INDEX cities_centre_gist_idx ON cities USING gist (centre);

    CREATE TABLE geocoding_daily_usage (
      usage_date date PRIMARY KEY,
      calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE geocoding_provider_schedule (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      next_allowed_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO geocoding_provider_schedule (singleton) VALUES (true);

    ALTER TABLE accounts ADD COLUMN city_id uuid REFERENCES cities(id) ON DELETE SET NULL;
    ALTER TABLE open_mics ADD COLUMN city_id uuid REFERENCES cities(id) ON DELETE SET NULL;
    ALTER TABLE events ADD COLUMN city_id uuid REFERENCES cities(id) ON DELETE SET NULL;
    ALTER TABLE registrations ADD COLUMN performer_city_id uuid REFERENCES cities(id) ON DELETE SET NULL;
    CREATE INDEX open_mics_city_id_idx ON open_mics (city_id);
    CREATE INDEX events_city_id_idx ON events (city_id);
    CREATE INDEX registrations_performer_city_id_idx ON registrations (performer_city_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS registrations_performer_city_id_idx;
    DROP INDEX IF EXISTS events_city_id_idx;
    DROP INDEX IF EXISTS open_mics_city_id_idx;
    ALTER TABLE registrations DROP COLUMN IF EXISTS performer_city_id;
    ALTER TABLE events DROP COLUMN IF EXISTS city_id;
    ALTER TABLE open_mics DROP COLUMN IF EXISTS city_id;
    ALTER TABLE accounts DROP COLUMN IF EXISTS city_id;
    DROP TABLE IF EXISTS geocoding_daily_usage;
    DROP TABLE IF EXISTS geocoding_provider_schedule;
    DROP TABLE IF EXISTS cities;
  `);
};
