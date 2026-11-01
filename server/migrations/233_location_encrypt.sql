-- Координаты людей (карта друзей, Sky Safety) хранятся зашифрованными (pos_enc), открытые lat/lng остаются только у старых записей.
ALTER TABLE loc_last ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE loc_last ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE loc_last ADD COLUMN IF NOT EXISTS pos_enc TEXT;
ALTER TABLE safety_events ADD COLUMN IF NOT EXISTS pos_enc TEXT;
-- Последняя точка — временная (заменяется при следующем обновлении, старше 24 ч не отдаётся): открытые копии стираем.
DELETE FROM loc_last WHERE pos_enc IS NULL;
UPDATE safety_events SET lat = NULL, lng = NULL WHERE lat IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at < now() - interval '1 day';
