-- SkyKassa Business: несколько организаций у одного владельца. Только добавляет/ослабляет.
-- «Текущая организация» человека — kb_active_business (общая для всех его устройств); у сотрудников ключ 'biz:<id>'.
DROP INDEX IF EXISTS kb_businesses_owner_idx;
CREATE INDEX IF NOT EXISTS kb_businesses_owner_idx2 ON kb_businesses (owner_id, created_at);

CREATE TABLE IF NOT EXISTS kb_active_business (
  profile_id  TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ключ → id организации: 'biz:<id>' (сотрудник) | id профиля владельца (его текущая организация, иначе самая старая).
CREATE OR REPLACE FUNCTION kb_cur_biz(k TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN k LIKE 'biz:%' THEN substr(k, 5) ELSE COALESCE(
    (SELECT a.business_id FROM kb_active_business a JOIN kb_businesses b ON b.id = a.business_id AND b.owner_id = a.profile_id WHERE a.profile_id = k),
    (SELECT id FROM kb_businesses WHERE owner_id = k ORDER BY created_at, id LIMIT 1)) END
$$;
