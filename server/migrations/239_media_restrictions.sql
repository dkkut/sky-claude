-- Ограничения доступа к произведениям и направлениям автора (Sky Media). Ничего не удаляется:
-- избранное, плейлисты, история и сами файлы остаются; ограничение лишь закрывает показ и воспроизведение.
CREATE TABLE IF NOT EXISTS media_restrictions (
  id           BIGSERIAL PRIMARY KEY,
  scope        TEXT NOT NULL CHECK (scope IN ('work','author_direction')),
  direction    TEXT NOT NULL CHECK (direction IN ('film','music','books','podcasts')),
  target_id    TEXT NOT NULL,                 -- scope=work: id произведения; scope=author_direction: id профиля автора
  author_id    TEXT,                          -- автор (владелец) на момент ограничения; для work заполняется сервером
  basis        TEXT NOT NULL,                 -- основание: жалоба, решение, ссылка на обращение (видят сотрудники и автор)
  ref          TEXT,                          -- внешний номер обращения/жалобы
  public_note  TEXT,                          -- короткий текст для баннера (видят все)
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lifted')),
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifted_by    TEXT,
  lifted_at    TIMESTAMPTZ,
  lift_reason  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS media_restrictions_active_uq ON media_restrictions (scope, direction, target_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS media_restrictions_author_idx ON media_restrictions (author_id, status);

CREATE TABLE IF NOT EXISTS media_restriction_appeals (
  id             BIGSERIAL PRIMARY KEY,
  restriction_id BIGINT NOT NULL REFERENCES media_restrictions(id),
  author_id      TEXT NOT NULL,
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS media_appeals_open_uq ON media_restriction_appeals (restriction_id) WHERE status = 'open';

-- Журнал только дописывается.
CREATE TABLE IF NOT EXISTS media_restriction_log (
  id             BIGSERIAL PRIMARY KEY,
  restriction_id BIGINT NOT NULL,
  actor_id       TEXT NOT NULL,
  action         TEXT NOT NULL,
  detail         TEXT,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION media_restriction_log_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'media_restriction_log is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS media_restriction_log_guard ON media_restriction_log;
CREATE TRIGGER media_restriction_log_guard BEFORE UPDATE OR DELETE ON media_restriction_log FOR EACH ROW EXECUTE FUNCTION media_restriction_log_guard();
