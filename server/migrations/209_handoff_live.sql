-- «Играть на нескольких устройствах»: передача «вживую» — получатель встаёт на то место, где отправитель находится сейчас (снимок + время, прошедшее с отправки).
ALTER TABLE handoffs ADD COLUMN IF NOT EXISTS live BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE handoffs ADD COLUMN IF NOT EXISTS group_id TEXT;
CREATE INDEX IF NOT EXISTS handoffs_group_idx ON handoffs (group_id) WHERE group_id IS NOT NULL;
