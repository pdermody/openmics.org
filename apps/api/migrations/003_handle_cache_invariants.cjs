exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX profiles_current_handle_uq
      ON profiles (current_handle)
      WHERE current_handle IS NOT NULL;

    CREATE UNIQUE INDEX open_mics_current_handle_uq
      ON open_mics (current_handle)
      WHERE current_handle IS NOT NULL;

    CREATE OR REPLACE FUNCTION maintain_current_handle_cache()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.status = 'current' THEN
        IF OLD.entity_type = 'profile' THEN
          UPDATE profiles SET current_handle = NULL
          WHERE id = OLD.profile_id AND current_handle = OLD.handle;
        ELSIF OLD.entity_type = 'open_mic' THEN
          UPDATE open_mics SET current_handle = NULL
          WHERE id = OLD.open_mic_id AND current_handle = OLD.handle;
        END IF;
      END IF;

      IF NEW.status = 'current' THEN
        IF NEW.entity_type = 'profile' THEN
          UPDATE profiles SET current_handle = NEW.handle
          WHERE id = NEW.profile_id;
        ELSIF NEW.entity_type = 'open_mic' THEN
          UPDATE open_mics SET current_handle = NEW.handle
          WHERE id = NEW.open_mic_id;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER handles_current_cache_trigger
      AFTER INSERT OR UPDATE OF handle, status, entity_type, profile_id, open_mic_id
      ON handles
      FOR EACH ROW
      EXECUTE FUNCTION maintain_current_handle_cache();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS handles_current_cache_trigger ON handles;
    DROP FUNCTION IF EXISTS maintain_current_handle_cache();
    DROP INDEX IF EXISTS open_mics_current_handle_uq;
    DROP INDEX IF EXISTS profiles_current_handle_uq;
  `);
};