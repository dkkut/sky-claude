-- Два разных системных режима, которые нельзя путать с «аварийным
-- режимом панели администратора» (admin_lockdown, 050_admin_security.sql
-- — тот закрывает только саму панель и обрывает чужие admin-сессии,
-- владелец всё равно проходит). Эти два — про сайт целиком для обычных
-- людей:
--
--   platform_shutdown   — «Аварийные работы»: сайт недоступен вообще
--                         никому, кроме владельца. Для тяжёлого
--                         инцидента (не просто подозрение на
--                         компрометацию панели, а реальная авария).
--   platform_maintenance — «Технические работы»: сайт недоступен
--                         обычным людям, но администрация (любой со
--                         статусом is_admin) продолжает работать —
--                         планово, не экстренно.
--
-- Включать и то, и другое может только владелец (та же логика, что у
-- admin_lockdown.setLockdown — системный рубильник такого масштаба не
-- отдаётся рядовому администратору).

CREATE TABLE IF NOT EXISTS platform_shutdown (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  reason     TEXT NOT NULL DEFAULT '',
  set_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  set_at     TIMESTAMPTZ
);
INSERT INTO platform_shutdown (id, active) VALUES (TRUE, FALSE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_maintenance (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  reason     TEXT NOT NULL DEFAULT '',
  set_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  set_at     TIMESTAMPTZ
);
INSERT INTO platform_maintenance (id, active) VALUES (TRUE, FALSE) ON CONFLICT DO NOTHING;
