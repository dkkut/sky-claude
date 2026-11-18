-- Sky Life: личное пространство человека (записи, цели, проекты, деловые связи). Только добавляет.
CREATE TABLE IF NOT EXISTS life_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  biz_enabled BOOLEAN NOT NULL DEFAULT true,
  free_items INT NOT NULL DEFAULT 300,
  prime_items INT NOT NULL DEFAULT 5000,
  free_storage_mb INT NOT NULL DEFAULT 100,
  prime_storage_mb INT NOT NULL DEFAULT 2000,
  free_posts INT NOT NULL DEFAULT 3,
  prime_posts INT NOT NULL DEFAULT 10,
  free_projects INT NOT NULL DEFAULT 3,
  prime_projects INT NOT NULL DEFAULT 20,
  free_match INT NOT NULL DEFAULT 10,
  prime_match INT NOT NULL DEFAULT 50,
  proposals_per_day INT NOT NULL DEFAULT 10,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO life_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS life_sys_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, position INT NOT NULL DEFAULT 0, enabled BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO life_sys_categories (id, name, position) VALUES
 ('plans','Личные планы',1),('life_goals','Жизненные цели',2),('dreams','Мечты',3),('dates','Важные даты',4),('family','Семейные события',5),
 ('birthdays','Дни рождения',6),('trips','Поездки',7),('education','Образование',8),('career','Карьера',9),('achievements','Достижения',10),
 ('purchases','Покупки',11),('projects_personal','Личные проекты',12),('contacts','Важные контакты',13),('notes','Личные заметки',14),('wishlists','Списки желаний',15)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS life_categories (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS life_prefs (
  owner_id TEXT PRIMARY KEY,
  home JSONB NOT NULL DEFAULT '{}'::jsonb,
  notif JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai JSONB NOT NULL DEFAULT '{}'::jsonb,
  fin_link BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Все личные записи: цели, этапы, задачи, события, воспоминания, важное, финансовые цели. Текст — data_enc (шифр), в колонках только служебное.
CREATE TABLE IF NOT EXISTS life_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('entry','goal','task','memory','important','fin_goal')),
  category TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','archived','cancelled')),
  priority SMALLINT NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 3),
  due_at TIMESTAMPTZ, event_at TIMESTAMPTZ, remind_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ, soon_notified_at TIMESTAMPTZ, overdue_notified_at TIMESTAMPTZ,
  parent_id TEXT REFERENCES life_items(id) ON DELETE CASCADE,
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  privacy TEXT NOT NULL DEFAULT 'private' CHECK (privacy IN ('private','sensitive')),
  data_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS life_items_owner ON life_items (owner_id, kind, status);
CREATE INDEX IF NOT EXISTS life_items_remind ON life_items (remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;
CREATE INDEX IF NOT EXISTS life_items_due ON life_items (due_at) WHERE due_at IS NOT NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS life_items_parent ON life_items (parent_id);

CREATE TABLE IF NOT EXISTS life_progress (
  id BIGSERIAL PRIMARY KEY, item_id TEXT NOT NULL REFERENCES life_items(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  progress SMALLINT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS life_progress_item ON life_progress (item_id, at);

CREATE TABLE IF NOT EXISTS life_files (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  item_id TEXT REFERENCES life_items(id) ON DELETE CASCADE,
  project_id TEXT, post_id TEXT, scope TEXT NOT NULL DEFAULT 'private' CHECK (scope IN ('private','project','deal','bizlogo')),
  name_enc TEXT NOT NULL, mime TEXT NOT NULL, bytes BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS life_files_owner ON life_files (owner_id);
CREATE INDEX IF NOT EXISTS life_files_item ON life_files (item_id);
CREATE INDEX IF NOT EXISTS life_files_project ON life_files (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS life_files_post ON life_files (post_id) WHERE post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS life_audit (
  id BIGSERIAL PRIMARY KEY, owner_id TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, target TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS life_audit_owner ON life_audit (owner_id, at DESC);

CREATE TABLE IF NOT EXISTS life_projects (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','members','public','link')),
  link_hash TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','archived')),
  data_enc TEXT NOT NULL, pub_title TEXT, pub_summary TEXT,
  linked_post_id TEXT, blocked BOOLEAN NOT NULL DEFAULT false, block_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS life_projects_owner ON life_projects (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS life_projects_link ON life_projects (link_hash) WHERE link_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS life_project_members (
  project_id TEXT NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE, profile_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager','member','viewer')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','removed')),
  invited_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (project_id, profile_id)
);
CREATE INDEX IF NOT EXISTS life_pm_profile ON life_project_members (profile_id, status);
CREATE TABLE IF NOT EXISTS life_project_tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE,
  data_enc TEXT NOT NULL, assignee_id TEXT, due_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','doing','done')),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS life_pt_project ON life_project_tasks (project_id);
CREATE TABLE IF NOT EXISTS life_project_msgs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE, author_id TEXT NOT NULL,
  text_enc TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS life_pmsg_project ON life_project_msgs (project_id, created_at);
CREATE TABLE IF NOT EXISTS life_project_log (
  id BIGSERIAL PRIMARY KEY, project_id TEXT NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE, actor_id TEXT, action TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_project_budget (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES life_projects(id) ON DELETE CASCADE,
  label_enc TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('plan','actual')), amount_rub BIGINT NOT NULL CHECK (amount_rub BETWEEN 0 AND 100000000000),
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_biz_profiles (
  owner_id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, contact_enc TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','rejected','blocked')),
  reason TEXT, reviewed_by TEXT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_biz_posts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('partner','cofounder','investor_ask','investor')),
  title TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}'::jsonb, private_enc TEXT, hidden JSONB NOT NULL DEFAULT '[]'::jsonb, risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','rejected','blocked','closed')),
  reason TEXT, reviewed_by TEXT, reviewed_at TIMESTAMPTZ, project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS life_bp_status ON life_biz_posts (status, kind, published_at DESC);
CREATE INDEX IF NOT EXISTS life_bp_owner ON life_biz_posts (owner_id);
CREATE TABLE IF NOT EXISTS life_biz_proposals (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES life_biz_posts(id) ON DELETE CASCADE, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  message_enc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','declined','withdrawn')),
  contact_shared BOOLEAN NOT NULL DEFAULT false, docs_shared BOOLEAN NOT NULL DEFAULT false, finance_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS life_bprop_active ON life_biz_proposals (post_id, from_id) WHERE status IN ('sent','accepted');
CREATE INDEX IF NOT EXISTS life_bprop_to ON life_biz_proposals (to_id, status);
CREATE INDEX IF NOT EXISTS life_bprop_from ON life_biz_proposals (from_id, status);
CREATE TABLE IF NOT EXISTS life_biz_history (
  id BIGSERIAL PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES life_biz_proposals(id) ON DELETE CASCADE, actor_id TEXT NOT NULL, event TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_biz_favs (
  owner_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK (target_type IN ('post','profile')), target_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (owner_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS life_biz_reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK (target_type IN ('post','profile','proposal','project')), target_id TEXT NOT NULL,
  reason TEXT NOT NULL, text TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  decided_by TEXT, decision TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS life_br_open ON life_biz_reports (reporter_id, target_type, target_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS life_restrictions (
  profile_id TEXT PRIMARY KEY, until TIMESTAMPTZ, reason TEXT NOT NULL, by_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_admin_log (
  id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT, reason TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_errors (
  id BIGSERIAL PRIMARY KEY, where_ TEXT NOT NULL, code TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
