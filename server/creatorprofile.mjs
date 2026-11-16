/**
 * Профиль автора внутри основного профиля Sky (никакой отдельной учётной записи).
 * Собирает по настоящим таблицам опубликованные работы человека в четырёх направлениях
 * (музыка, кино и сериалы, подкасты, книги), публичные плейлисты, подписчиков и суммарные
 * прослушивания/просмотры. Выдуманных цифр нет: чего у сервера нет, того нет и в ответе.
 * Видимость — те же настройки профиля `profileVisibility` и исключения по людям, что у остальных разделов.
 * Автор музыки — правообладатель (владелец карточки музыканта), а не загрузивший трек.
 * Доступность отдельных работ (ограничения Sky Copyright и направлений автора) подключается этапами 4–6
 * через единую точку `server/mediarestrict.mjs`.
 */
import { query } from './db.mjs';
import { getPrivacy, exceptionOf } from './privacy.mjs';
import { authorBlocks } from './mediarestrict.mjs';

/** Направление → ключ видимости в profileVisibility. */
export const CREATOR_KEYS = { music: 'showCreatorMusic', film: 'showCreatorFilm', podcasts: 'showCreatorPodcasts', books: 'showCreatorBooks', stats: 'showCreatorStats' };

const LIMIT = 12;

const visibleFor = async (viewerId, targetId, own) => {
  const out = {};
  if (own) { for (const k of Object.keys(CREATOR_KEYS)) out[k] = true; return out; }
  const priv = await getPrivacy(targetId);
  for (const [k, key] of Object.entries(CREATOR_KEYS)) {
    const exc = await exceptionOf(targetId, viewerId, key);
    out[k] = exc === 'allow' ? true : exc === 'deny' ? false : priv.profileVisibility?.[key] !== false;
  }
  return out;
};

export const getCreatorProfile = async (viewerId, targetId) => {
  const prof = (await query(`SELECT id FROM profiles WHERE id=$1`, [targetId])).rows[0];
  if (!prof) return { error: 'not_found' };
  const own = viewerId === targetId;
  const vis = await visibleFor(viewerId, targetId, own);
  const pubOnly = own ? '' : " AND status='published'";
  const res = { own, visibility: vis, directions: {} };

  const followers = (await query(`SELECT count(*)::int AS n FROM follows WHERE following_id=$1`, [targetId])).rows[0].n;
  res.followers = followers;
  let plays = 0; let views = 0;

  if (vis.music) {
    // Автор музыки — ПРАВООБЛАДАТЕЛЬ: подтверждённый владелец карточки музыканта (music_artist_cards.owner_id).
    // Тот, кто загрузил трек (music_tracks.owner_id), — отдельный человек и автором не считается.
    const cards = (await query(`SELECT id, name FROM music_artist_cards WHERE owner_id=$1`, [targetId])).rows;
    const ids = cards.map((c) => c.id);
    const tracks = ids.length ? (await query(
      `SELECT id, title, artist, duration_sec, plays, status, artist_card_id FROM music_tracks WHERE artist_card_id = ANY($1::text[])${pubOnly} ORDER BY created_at DESC LIMIT ${LIMIT}`, [ids])).rows : [];
    const tot = ids.length ? (await query(`SELECT count(*)::int AS n, COALESCE(sum(plays),0)::bigint AS p FROM music_tracks WHERE artist_card_id = ANY($1::text[]) AND status='published'`, [ids])).rows[0] : { n: 0, p: 0 };
    const albums = ids.length ? (await query(
      `SELECT a.id, a.title, a.year, count(t.id)::int AS tracks
         FROM music_albums a JOIN music_tracks t ON t.album_id=a.id AND t.status='published'
        WHERE a.card_id = ANY($1::text[]) AND NOT a.hidden GROUP BY a.id ORDER BY a.created_at DESC LIMIT ${LIMIT}`, [ids])).rows : [];
    const pl = (await query(
      `SELECT p.id, p.name, (SELECT count(*) FROM music_playlist_items i WHERE i.playlist_id=p.id)::int AS count
         FROM music_playlists p WHERE p.owner_id=$1 AND p.is_public ORDER BY p.updated_at DESC LIMIT ${LIMIT}`, [targetId])).rows;
    plays += Number(tot.p);
    res.directions.music = {
      count: tot.n, plays: Number(tot.p), cards: cards.map((c) => ({ id: c.id, name: c.name })),
      tracks: tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration_sec, plays: Number(t.plays), status: t.status })),
      albums, playlists: pl,
    };
  }

  if (vis.film) {
    const films = (await query(
      `SELECT id, title, year, views, status, is_short FROM film_movies WHERE owner_id=$1 AND series_id IS NULL${pubOnly} ORDER BY created_at DESC LIMIT ${LIMIT}`, [targetId])).rows;
    const ft = (await query(`SELECT count(*)::int AS n, COALESCE(sum(views),0)::bigint AS v FROM film_movies WHERE owner_id=$1 AND series_id IS NULL AND status='published'`, [targetId])).rows[0];
    const series = (await query(
      `SELECT s.id, s.title, s.status,
              (SELECT count(*) FROM film_movies m WHERE m.series_id=s.id AND m.status='published')::int AS episodes,
              (SELECT COALESCE(sum(views),0) FROM film_movies m WHERE m.series_id=s.id)::bigint AS views
         FROM film_series s WHERE s.owner_id=$1${own ? '' : " AND s.status='published'"} ORDER BY s.created_at DESC LIMIT ${LIMIT}`, [targetId])).rows;
    const sv = series.reduce((a, s) => a + Number(s.views), 0);
    views += Number(ft.v) + sv;
    res.directions.film = {
      count: ft.n, seriesCount: series.length, views: Number(ft.v) + sv,
      films: films.map((f) => ({ id: f.id, title: f.title, year: f.year, views: Number(f.views), status: f.status, short: f.is_short })),
      series: series.map((s) => ({ id: s.id, title: s.title, episodes: s.episodes, views: Number(s.views), status: s.status })),
    };
  }

  if (vis.podcasts) {
    const pods = (await query(
      `SELECT p.id, p.title, p.status,
              (SELECT count(*) FROM podcast_episodes e WHERE e.podcast_id=p.id AND e.published)::int AS episodes,
              (SELECT COALESCE(sum(plays),0) FROM podcast_episodes e WHERE e.podcast_id=p.id)::bigint AS plays
         FROM podcasts p WHERE p.owner_id=$1${own ? '' : " AND p.status='published'"} ORDER BY p.created_at DESC LIMIT ${LIMIT}`, [targetId])).rows;
    const pp = pods.reduce((a, p) => a + Number(p.plays), 0);
    plays += pp;
    res.directions.podcasts = { count: pods.length, plays: pp, items: pods.map((p) => ({ id: p.id, title: p.title, episodes: p.episodes, plays: Number(p.plays), status: p.status })) };
  }

  if (vis.books) {
    const books = (await query(`SELECT id, title, status FROM books WHERE author_id=$1${pubOnly} ORDER BY created_at DESC LIMIT ${LIMIT}`, [targetId])).rows;
    const bt = (await query(`SELECT count(*)::int AS n FROM books WHERE author_id=$1 AND status='published'`, [targetId])).rows[0].n;
    res.directions.books = { count: bt, items: books.map((b) => ({ id: b.id, title: b.title, status: b.status })) };
  }

  // Ограничения Sky Media: закрытое направление автора — баннер вместо списка (владелец видит свои работы с пометкой); отдельные ограничённые работы помечаются.
  const dirBlocks = await authorBlocks(targetId);
  const workBlocks = new Set((await query(`SELECT direction || ':' || target_id AS k FROM media_restrictions WHERE status='active' AND scope='work' AND author_id=$1`, [targetId])).rows.map((r) => r.k));
  const lists = { music: ['tracks'], film: ['films', 'series'], podcasts: ['items'], books: ['items'] };
  for (const [dir, d] of Object.entries(res.directions)) {
    for (const key of lists[dir] ?? []) for (const w of d[key] ?? []) if (workBlocks.has(`${dir}:${w.id}`)) w.blocked = true;
    if (dirBlocks[dir]) {
      d.blocked = dirBlocks[dir];
      if (!own) { for (const key of lists[dir] ?? []) d[key] = []; if (dir === 'music') { d.albums = []; d.playlists = []; } }
    }
  }
  if (vis.stats) res.totals = { plays, views };
  res.hasWorks = Object.values(res.directions).some((d) => d.blocked || d.count > 0 || (d.items?.length ?? 0) > 0 || (d.tracks?.length ?? 0) > 0);
  return res;
};
