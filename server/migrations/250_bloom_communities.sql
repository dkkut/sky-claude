-- Bloom: сообщества. Только добавляет; посты сообщества — обычные посты Bloom с community_id.
CREATE TABLE IF NOT EXISTS bloom_communities (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_]{3,30}$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🌸',
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public','closed')),
  post_policy TEXT NOT NULL DEFAULT 'all' CHECK (post_policy IN ('all','mods')),
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked BOOLEAN NOT NULL DEFAULT false, block_reason TEXT, blocked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bloom_comm_owner ON bloom_communities (owner_id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS bloom_community_members (
  community_id TEXT NOT NULL REFERENCES bloom_communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','mod','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','banned')),
  ban_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, profile_id)
);
CREATE INDEX IF NOT EXISTS bloom_cm_profile ON bloom_community_members (profile_id, status);
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS community_id TEXT REFERENCES bloom_communities(id) ON DELETE CASCADE;
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS community_pinned BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS bloom_posts_community ON bloom_posts (community_id, created_at DESC) WHERE deleted_at IS NULL AND community_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS bloom_community_log (
  id BIGSERIAL PRIMARY KEY, community_id TEXT NOT NULL REFERENCES bloom_communities(id) ON DELETE CASCADE, actor_id TEXT, action TEXT NOT NULL, target TEXT, reason TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bloom_clog_c ON bloom_community_log (community_id, at DESC);
CREATE TABLE IF NOT EXISTS bloom_community_reports (
  id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES bloom_communities(id) ON DELETE CASCADE, reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL, text TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  decided_by TEXT, decision TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS bloom_cr_open ON bloom_community_reports (community_id, reporter_id) WHERE status = 'open';
