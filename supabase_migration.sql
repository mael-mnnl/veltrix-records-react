-- ═══════════════════════════════════════════════════════════════
--  Migration Veltrix — à exécuter dans Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Nouvelles colonnes sur la table slots existante
ALTER TABLE slots ADD COLUMN IF NOT EXISTS price        NUMERIC(10,2);
ALTER TABLE slots ADD COLUMN IF NOT EXISTS notified_at  TIMESTAMPTZ;

-- 2. Table slot_events (historique / audit log)
CREATE TABLE IF NOT EXISTS slot_events (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_id      UUID        REFERENCES slots(id) ON DELETE SET NULL,
  event_type   TEXT        NOT NULL,   -- 'created' | 'removed' | 'expired' | 'updated'
  track_name   TEXT,
  track_artist TEXT,
  buyer        TEXT,
  price        NUMERIC(10,2),
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 3. Table buyers (infos enrichies sur les acheteurs)
CREATE TABLE IF NOT EXISTS buyers (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT        NOT NULL UNIQUE,
  email      TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Table playlists_cache (snapshot des playlists Spotify)
CREATE TABLE IF NOT EXISTS playlists_cache (
  id            TEXT        PRIMARY KEY,   -- Spotify playlist ID
  name          TEXT,
  cover_url     TEXT,
  followers     INT,
  tracks_total  INT,
  snapshot_id   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 5. Trigger : auto-log dans slot_events à chaque INSERT ou UPDATE de statut
CREATE OR REPLACE FUNCTION fn_log_slot_event()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO slot_events (slot_id, event_type, track_name, track_artist, buyer, price)
    VALUES (NEW.id, 'created', NEW.track_name, NEW.track_artist, NEW.buyer, NEW.price);
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO slot_events (slot_id, event_type, track_name, track_artist, buyer, price)
    VALUES (NEW.id, NEW.status, NEW.track_name, NEW.track_artist, NEW.buyer, NEW.price);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_slots_audit ON slots;
CREATE TRIGGER trg_slots_audit
  AFTER INSERT OR UPDATE ON slots
  FOR EACH ROW EXECUTE FUNCTION fn_log_slot_event();
