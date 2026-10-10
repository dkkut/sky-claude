-- Реальные трек-номера посылок: СДЭК, Почта России и зарубежные службы.
--
-- Номер, который сервер выдавал сам при отправке (market_shipments.tracking),
-- был внутренним и ни к какой настоящей посылке не вёл. Здесь — то, что
-- продавец получил у службы при сдаче посылки. Заказ эта таблица не
-- двигает: состояние посылки только показывается, а «доставлено» для
-- заказа по-прежнему подтверждает покупатель или пункт выдачи.
CREATE TABLE IF NOT EXISTS parcel_tracking (
  order_id   TEXT PRIMARY KEY REFERENCES market_orders(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  number     TEXT NOT NULL,
  set_by     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parcel_tracking_number_idx ON parcel_tracking (provider, number);

-- Ответ службы держим коротко: служба платная или с лимитами, а человек
-- открывает экран заказа много раз.
CREATE TABLE IF NOT EXISTS parcel_tracking_cache (
  provider   TEXT NOT NULL,
  number     TEXT NOT NULL,
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, number)
);
