// Media pipeline tables, promoted from the former post-MVP appendix sketch in
// docs/architecture/data-model.md into the Phase 1 schema, with the Phase 1 additions
// from media-gallery-plan.md: intrinsic dimensions, video platform metadata, alt_text,
// renditions jsonb, and denormalized performer attribution snapshots (captured at
// publish time so a soft-deleted registration leaves captions intact).
//
// - Media rows have exactly one owning scope: event_id XOR open_mic_id.
// - Series-scope media is always free-standing (no registration attribution).
// - Video rows carry an allowlisted platform + canonical id; photo rows never do.
// - S3 bytes are never deleted inline: deletes enqueue PendingS3Deletions rows for the
//   scheduled purge worker, timed at the media row's recovery_deadline.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      media_type text NOT NULL,
      event_id uuid REFERENCES events(id),
      open_mic_id uuid REFERENCES open_mics(id),
      registration_id uuid REFERENCES registrations(id),
      added_by_profile_id uuid NOT NULL REFERENCES profiles(id),
      source_url text NOT NULL,
      mime_type text,
      size_bytes bigint,
      width integer,
      height integer,
      duration_seconds integer,
      video_platform text,
      platform_video_id text,
      thumbnail_url text,
      caption text,
      alt_text text,
      renditions jsonb,
      performer_name_snapshot text,
      performer_city_snapshot text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      deleted_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      recovery_deadline timestamptz,
      deletion_reason text,
      CONSTRAINT media_type_check CHECK (media_type IN ('photo', 'video')),
      CONSTRAINT media_scope_check CHECK ((event_id IS NULL) <> (open_mic_id IS NULL)),
      CONSTRAINT media_series_freestanding_check CHECK (event_id IS NOT NULL OR registration_id IS NULL),
      CONSTRAINT media_video_check CHECK (
        (media_type = 'video' AND video_platform IN ('youtube', 'vimeo') AND platform_video_id IS NOT NULL)
        OR (media_type = 'photo' AND video_platform IS NULL AND platform_video_id IS NULL AND duration_seconds IS NULL)
      ),
      CONSTRAINT media_deletion_reason_check CHECK (deletion_reason IS NULL OR deletion_reason IN ('organizer', 'consent_revocation')),
      CONSTRAINT media_deletion_fields_check CHECK (
        (deleted_at IS NULL AND deleted_by_profile_id IS NULL AND recovery_deadline IS NULL AND deletion_reason IS NULL)
        OR (deleted_at IS NOT NULL AND recovery_deadline IS NOT NULL AND deletion_reason IS NOT NULL)
      )
    );

    CREATE INDEX media_event_created_idx ON media (event_id, created_at DESC, id) WHERE deleted_at IS NULL;
    CREATE INDEX media_open_mic_created_idx ON media (open_mic_id, created_at DESC, id);
    CREATE INDEX media_registration_idx ON media (registration_id);
    CREATE INDEX media_deleted_at_idx ON media (deleted_at);
    CREATE INDEX media_deletion_reason_idx ON media (deletion_reason);

    CREATE TABLE pending_s3_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket text NOT NULL,
      object_key text NOT NULL,
      media_id uuid REFERENCES media(id) ON DELETE SET NULL,
      reason text NOT NULL,
      scheduled_for timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz,
      CONSTRAINT pending_s3_deletions_reason_check CHECK (reason IN ('purge', 'replace', 'abandoned_upload', 'manual'))
    );

    CREATE INDEX pending_s3_deletions_due_idx ON pending_s3_deletions (scheduled_for) WHERE processed_at IS NULL;
    CREATE INDEX pending_s3_deletions_object_idx ON pending_s3_deletions (bucket, object_key);

    CREATE TABLE open_mic_featured_media (
      open_mic_id uuid NOT NULL REFERENCES open_mics(id) ON DELETE CASCADE,
      media_id uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      position integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT open_mic_featured_media_pk PRIMARY KEY (open_mic_id, media_id),
      CONSTRAINT open_mic_featured_media_position_uq UNIQUE (open_mic_id, position)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS open_mic_featured_media;
    DROP TABLE IF EXISTS pending_s3_deletions;
    DROP TABLE IF EXISTS media;
  `);
};
