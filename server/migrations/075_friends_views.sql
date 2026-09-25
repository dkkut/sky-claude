-- Дружба и счётчик просмотров профиля.
--
-- Обе вещи раньше жили только в localStorage браузера
-- (src/profile/viewer/social.ts): «заявка в друзья» существовала только
-- в браузере того, кто её отправил — адресат никогда её не получал,
-- потому что в его собственном localStorage этой записи просто не было.
-- «Просмотры профиля» считались в браузере СМОТРЯЩЕГО (views[targetId]),
-- а не у того, чей профиль смотрят, — так что владелец профиля свои же
-- просмотры не видел никогда, ни на одном своём устройстве.
--
-- Дружба — не то же самое, что подписка (follows, см. миграцию 068):
-- подписка одностороння и без подтверждения, дружба двусторонняя и
-- требует принятия заявки. Так и было задумано в профиль-вьюере —
-- оставляем два отдельных отношения.

CREATE TABLE IF NOT EXISTS friendships (
  a_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  b_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id < b_id),
  CHECK (requested_by = a_id OR requested_by = b_id)
);
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships (b_id);

-- Один и тот же смотрящий увеличивает счётчик один раз, а не при каждом
-- заходе: PRIMARY KEY(target_id, viewer_id) + ON CONFLICT DO NOTHING —
-- тот же приём, что уже есть у bloom_views (миграция 068).
CREATE TABLE IF NOT EXISTS profile_views (
  target_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewer_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, viewer_id)
);
