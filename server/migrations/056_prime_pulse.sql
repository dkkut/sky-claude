-- ============================================================
--  Prime Pulse — с нуля, на сервере
-- ============================================================
--
-- До этой миграции Prime Pulse (src/prime/PrimePulse.tsx) был
-- десятком захардкоженных предложений с фейковыми промокодами:
-- кнопка «Активировать» ничего не делала, а «скопировать код»
-- копировала одну и ту же строку всем подписчикам без разбора.
--
-- Теперь предложения — записи в базе, которые заводит и снимает
-- администратор с правом content (та же роль, что уже управляет
-- музыкой, кино и подкастами). Погашение — не фейковый clipboard:
-- сервер выдаёт свой, единственный для этого человека и этого
-- предложения код и помнит, что он выдан.

CREATE TABLE IF NOT EXISTS prime_pulse_offers (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL DEFAULT 'promo'
                  CHECK (category IN ('game','service','promo','fun')),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  brand         TEXT NOT NULL DEFAULT 'Sky',
  value_label   TEXT NOT NULL,
  color1        TEXT NOT NULL DEFAULT '#f59e0b',
  color2        TEXT NOT NULL DEFAULT '#d97706',
  -- Вне этого окна предложение не показывается, даже если active.
  starts_at     TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Сколько раз один человек может погасить это предложение.
  max_per_user  INT NOT NULL DEFAULT 1 CHECK (max_per_user > 0 AND max_per_user <= 100),
  created_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prime_pulse_offers_active_idx
  ON prime_pulse_offers (active, expires_at);

-- Погашение: свой код на человека и предложение. Код рождается на
-- сервере в момент погашения — заранее заготовленных пулов кодов
-- нет, поэтому подделать «ещё не выданный» код нечем.
CREATE TABLE IF NOT EXISTS prime_pulse_redemptions (
  id            TEXT PRIMARY KEY,
  offer_id      TEXT NOT NULL REFERENCES prime_pulse_offers(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  redeemed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prime_pulse_redemptions_user_idx
  ON prime_pulse_redemptions (user_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS prime_pulse_redemptions_offer_user_idx
  ON prime_pulse_redemptions (offer_id, user_id);
