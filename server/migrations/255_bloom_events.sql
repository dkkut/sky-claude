-- Bloom: мероприятия. Публикуются организатором (или модератором сообщества), участие — «пойду» / «интересно».
CREATE TABLE IF NOT EXISTS bloom_events (
  id            TEXT PRIMARY KEY,
  organizer_id  TEXT NOT NULL,
  community_id  TEXT,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ,
  place         TEXT,
  online_url    TEXT,
  capacity      INTEGER,
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT,
  held_at       TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ,
  removed_by    TEXT,
  remove_reason TEXT,
  reminded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bloom_events_start_idx ON bloom_events (starts_at) WHERE removed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS bloom_events_org_idx ON bloom_events (organizer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bloom_events_comm_idx ON bloom_events (community_id) WHERE community_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bloom_event_rsvp (
  event_id   TEXT NOT NULL REFERENCES bloom_events(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('going','interested')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, profile_id)
);
CREATE INDEX IF NOT EXISTS bloom_event_rsvp_profile_idx ON bloom_event_rsvp (profile_id, status);
