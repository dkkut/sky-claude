-- Кэш для виджетов погоды и курсов в Bloom (см. server/weather.mjs,
-- server/currency.mjs). Сторонние API бесплатные и без ключа
-- (Open-Meteo, ЦБ РФ, CoinGecko), но не резиновые — один и тот же
-- город/валюту спрашивают у них не чаще, чем раз в окно кэша, а не при
-- каждом открытии виджета каждым пользователем.

CREATE TABLE IF NOT EXISTS weather_cache (
  lat_r      REAL NOT NULL,
  lon_r      REAL NOT NULL,
  city       TEXT,
  temp_c     REAL NOT NULL,
  code       INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lat_r, lon_r)
);

CREATE TABLE IF NOT EXISTS currency_cache (
  code        TEXT PRIMARY KEY,
  rate        REAL NOT NULL,
  change_pct  REAL NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
