-- Sky Garant: сделки с передачей данных гаранту и режимом проверки (flow 'sale') и обмен (flow 'exchange').
-- Прежние сделки (flow 'classic') не меняются. Данные сторон лежат зашифрованными и показываются другой стороне только в режиме проверки.
ALTER TABLE garant_deals ADD COLUMN IF NOT EXISTS flow TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE garant_deals DROP CONSTRAINT IF EXISTS garant_deals_flow_check;
ALTER TABLE garant_deals ADD CONSTRAINT garant_deals_flow_check CHECK (flow IN ('classic','sale','exchange'));
ALTER TABLE garant_deals ADD COLUMN IF NOT EXISTS counter_item_name TEXT NOT NULL DEFAULT '';
ALTER TABLE garant_deals ADD COLUMN IF NOT EXISTS seller_approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE garant_deals ADD COLUMN IF NOT EXISTS buyer_approved  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE garant_deals ADD COLUMN IF NOT EXISTS dispute_from TEXT;           -- из какого состояния открыт спор

ALTER TABLE garant_deals DROP CONSTRAINT IF EXISTS garant_deals_status_check;
ALTER TABLE garant_deals ADD CONSTRAINT garant_deals_status_check
  CHECK (status IN ('pending_seller','pending_buyer','in_escrow','completed','cancelled','disputed','awaiting_data','confirming','verifying','paid'));
-- обмен без денег: цена 0 допустима (у прежних сделок цену >0 проверяет код createDeal)
ALTER TABLE garant_deals DROP CONSTRAINT IF EXISTS garant_deals_price_check;
ALTER TABLE garant_deals ADD CONSTRAINT garant_deals_price_check CHECK (price >= 0);

CREATE TABLE IF NOT EXISTS garant_deal_data (
  deal_id      TEXT NOT NULL REFERENCES garant_deals(id) ON DELETE CASCADE,
  side         TEXT NOT NULL CHECK (side IN ('seller','buyer')),
  data_enc     TEXT NOT NULL,                 -- зашифрованный JSON {fields:[{label,value}], note}
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,                   -- сторона подтвердила, что её данные верны (дальше не правятся)
  PRIMARY KEY (deal_id, side)
);
