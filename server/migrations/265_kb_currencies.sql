-- SkyKassa Business: приём разных валют. Sky деньги не принимает и курсов не выдумывает:
-- организация сама перечисляет валюты, в которых готова получать прямые переводы, и свои реквизиты для каждой.
ALTER TABLE kb_businesses ADD COLUMN IF NOT EXISTS currencies TEXT[] NOT NULL DEFAULT '{RUB}';

-- Реквизиты рублей остаются в kb_requisites; для остальных валют — отдельная строка на валюту.
CREATE TABLE IF NOT EXISTS kb_requisites_cur (
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL,
  data_enc    TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, currency)
);
