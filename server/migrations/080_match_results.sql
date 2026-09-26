-- Самоотчёт о результате матча с подтверждением соперника.
--
-- За карточками игр (CS2/Dota2/Fortnite) нет ни одного настоящего
-- игрового сервера Sky, который мог бы сам сообщить исход раунда —
-- эти игры целиком идут у игроков локально/в Steam/Epic. Единственный
-- честный источник исхода — сами игроки. Чтобы одна сторона не могла
-- приписать себе победу в одностороннем порядке, результат применяется
-- только после того, как его подтвердит КТО-ТО ИЗ ПРОТИВОПОЛОЖНОЙ
-- команды — не сам заявитель и не его же союзник.

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'reported', 'completed', 'disputed'));

ALTER TABLE matches ADD COLUMN IF NOT EXISTS reported_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS reported_winner TEXT CHECK (reported_winner IN ('a', 'b'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS reported_at     TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS resolved_at     TIMESTAMPTZ;
