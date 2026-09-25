-- Пометки и блокировки контента модерацией (видео-каналы SkyVideo,
-- каналы мессенджера, фильмы) — раньше жили только в localStorage
-- браузера самого администратора (src/shared/moderationStore.ts).
-- Кнопка «Заблокировать за скам» выглядела как настоящая модерация, а
-- на деле не значила вообще ничего ни для одного другого человека на
-- платформе: badge и сам блок показывались только в том же браузере,
-- где по ним нажали. Один администратор — один изолированный
-- localStorage; ни другой администратор, ни тем более обычный
-- пользователь никогда не видели этот блок.
CREATE TABLE IF NOT EXISTS content_flags (
  domain       TEXT NOT NULL CHECK (domain IN ('video-channel', 'messenger-channel', 'movie')),
  target_id    TEXT NOT NULL,
  warning      TEXT CHECK (warning IN ('casino', '18+', 'casino18')),
  blocked      BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason TEXT,
  blocked_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  blocked_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, target_id)
);
