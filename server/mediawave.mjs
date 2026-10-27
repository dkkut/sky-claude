/**
 * SkyWave: персональные подборки из Music / Film / Video / Podcasts / Books.
 * Только настоящие данные: история, избранное, подписки, прогресс, жанры, популярность. Если сигналов мало, подборка
 * честно помечается как редакционная/популярная (`personal:false`), а не выдаётся за персональную. Права учитываются на сервере:
 * закрытое Prime-содержимое без подписки не попадает, приватное чужое не попадает, 18+ — только совершеннолетним.
 * Подборка строится независимо: сбой одного источника не ломает остальные. В диагностику (wave_stats) пишутся счётчики и время, без личных данных.
 */
import { query } from './db.mjs';
import { entitlementsOf } from './entitlements.mjs';
import { L } from './lang.mjs';
import { duoQueue } from './musicduo.mjs';

export const SHELF_IDS = ['for_you', 'continue', 'my_music', 'new', 'trending', 'similar', 'discover', 'evening', 'short', 'collection', 'recent', 'return', 'together'];
const PER = 12;
const KINDS = ['music', 'film', 'video', 'podcast', 'book'];
const CALM = /ambient|chill|lo-?fi|classical|jazz|acoustic|инструмент|классик|джаз|спокой|эмбиент|релакс/i;

const title = (ru, en) => L(ru, en);
export const SHELF_TITLES = () => ({
  for_you: title('Для тебя', 'For you'), continue: title('Продолжить', 'Continue'), my_music: title('Твоя музыка', 'Your music'),
  new: title('Новое в Sky', 'New in Sky'), trending: title('В тренде', 'Trending'), similar: title('Похожие на твои любимые', 'Similar to your favorites'),
  discover: title('Открой новое', 'Discover new'), evening: title('На вечер', 'For the evening'), short: title('Короткий перерыв', 'Quick break'),
  collection: title('Твоя коллекция', 'Your collection'), together: title('Вместе интереснее', 'Better together'), recent: title('Недавно добавлено', 'Recently added'), return: title('Вернись к этому', 'Come back to this'),
});

const adultOf = async (profileId) => {
  const r = (await query('SELECT date_of_birth FROM profiles WHERE id=$1', [profileId])).rows[0];
  if (!r?.date_of_birth) return false;   // возраст неизвестен — считаем несовершеннолетним
  return (Date.now() - new Date(r.date_of_birth).getTime()) / 31557600000 >= 18;
};

const item = (kind, id, t, sub, extra = {}) => ({ kind, id: String(id), title: t, sub: sub ?? '', ...extra });

/** Обратная связь человека: скрытое, приглушённые авторы, «больше/меньше». */
const loadFeedback = async (profileId) => {
  const { rows } = await query('SELECT kind, item_id, signal, author_key FROM wave_feedback WHERE profile_id=$1 ORDER BY created_at DESC LIMIT 2000', [profileId]);
  const hidden = new Set(); const muted = new Set(); const more = new Set(); const less = new Set();
  for (const r of rows) {
    const key = `${r.kind}:${r.item_id}`;
    if (r.signal === 'hide') hidden.add(key);
    else if (r.signal === 'mute_author' && r.author_key) muted.add(r.author_key);
    else if (r.signal === 'more') { more.add(key); if (r.author_key) more.add(`a:${r.author_key}`); }
    else if (r.signal === 'less') { less.add(key); if (r.author_key) less.add(`a:${r.author_key}`); }
  }
  return { hidden, muted, more, less };
};

/** Вкус: жанры и исполнители по избранному (вес 3) и недавней истории (вес 1). */
const loadTaste = async (profileId) => {
  const { rows } = await query(
    `SELECT t.genre, lower(t.artist) AS artist, SUM(w) AS w FROM (
        SELECT track_id, 3 AS w FROM music_favorites WHERE user_id=$1
        UNION ALL SELECT track_id, 1 FROM (SELECT track_id FROM music_history WHERE user_id=$1 ORDER BY played_at DESC LIMIT 200) h
      ) s JOIN music_tracks t ON t.id = s.track_id GROUP BY t.genre, lower(t.artist)`, [profileId]);
  const genres = new Map(); const artists = new Map();
  for (const r of rows) {
    const w = Number(r.w) || 0;
    if (r.genre) genres.set(r.genre.toLowerCase(), (genres.get(r.genre.toLowerCase()) ?? 0) + w);
    if (r.artist) artists.set(r.artist, (artists.get(r.artist) ?? 0) + w);
  }
  const total = [...genres.values()].reduce((a, b) => a + b, 0);
  return { genres, artists, total, topGenres: [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]), signals: total };
};

const authorKeyOf = (kind, row) => (kind === 'music' ? `m:${String(row.artist ?? '').toLowerCase()}` : `o:${row.owner_id ?? ''}`);

/* ---------- построители подборок: каждый возвращает { items, personal, reason } ---------- */

const builders = {
  async continue(ctx) {
    const out = [];
    const q = [
      ctx.prime && query(`SELECT m.id, m.title, p.position_sec AS pos, p.duration_sec AS dur, p.updated_at FROM film_progress p JOIN film_movies m ON m.id=p.movie_id
                          WHERE p.user_id=$1 AND p.duration_sec>0 AND p.position_sec>30 AND p.position_sec < p.duration_sec*0.92 AND (m.status='published' OR m.owner_id=$1) ORDER BY p.updated_at DESC LIMIT 6`, [ctx.id])
        .then((r) => r.rows.forEach((x) => out.push(item('film', x.id, x.title, '', { progress: x.pos / x.dur, at: x.updated_at })))),
      query(`SELECT v.id, v.title, p.position_sec AS pos, p.duration_sec AS dur, p.updated_at FROM sky_video_progress p JOIN sky_videos v ON v.id=p.video_id
              WHERE p.user_id=$1 AND p.duration_sec>0 AND p.position_sec>10 AND p.position_sec < p.duration_sec*0.92 AND v.status='published' AND v.privacy<>'private' ORDER BY p.updated_at DESC LIMIT 6`, [ctx.id])
        .then((r) => r.rows.forEach((x) => out.push(item('video', x.id, x.title, '', { progress: x.pos / x.dur, at: x.updated_at })))),
      ctx.prime && query(`SELECT e.id, e.title, p.position_sec AS pos, p.duration_sec AS dur, p.updated_at FROM podcast_progress p JOIN podcast_episodes e ON e.id=p.episode_id
              WHERE p.user_id=$1 AND NOT p.completed AND p.duration_sec>0 AND p.position_sec>30 ORDER BY p.updated_at DESC LIMIT 6`, [ctx.id])
        .then((r) => r.rows.forEach((x) => out.push(item('podcast', x.id, x.title, '', { progress: x.pos / x.dur, at: x.updated_at })))),
      ctx.prime && query(`SELECT b.id, b.title, p.updated_at FROM book_progress p JOIN books b ON b.id=p.book_id
              WHERE p.user_id=$1 AND NOT p.completed AND (b.status='published' OR b.author_id=$1) ORDER BY p.updated_at DESC LIMIT 6`, [ctx.id])
        .then((r) => r.rows.forEach((x) => out.push(item('book', x.id, x.title, '', { at: x.updated_at })))),
    ].filter(Boolean);
    await Promise.all(q);
    out.sort((a, b) => new Date(b.at) - new Date(a.at));
    return { items: out, personal: true, reason: L('Вы остановились на этом', 'You stopped here') };
  },

  async my_music(ctx) {
    if (!ctx.prime) return { items: [] };
    const { rows } = await query(
      `SELECT t.id, t.title, t.artist, t.owner_id FROM music_favorites f JOIN music_tracks t ON t.id=f.track_id
        WHERE f.user_id=$1 AND (t.status='published' OR t.owner_id=$1) ORDER BY f.created_at DESC LIMIT $2`, [ctx.id, PER * 2]);
    return { items: rows.map((r) => item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r) })), personal: true, reason: L('Из вашего избранного', 'From your favorites') };
  },

  async for_you(ctx) {
    const items = []; let personal = false;
    if (ctx.prime && ctx.taste.topGenres.length) {
      personal = true;
      const { rows } = await query(
        `SELECT t.id, t.title, t.artist, t.owner_id, t.genre, t.plays FROM music_tracks t
          WHERE t.status='published' AND lower(t.genre) = ANY($2) AND NOT EXISTS (SELECT 1 FROM music_favorites f WHERE f.user_id=$1 AND f.track_id=t.id)
          ORDER BY t.plays DESC, t.created_at DESC LIMIT 40`, [ctx.id, ctx.taste.topGenres]);
      for (const r of rows) items.push(item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r), genre: r.genre, reason: L(`Вам нравится жанр «${r.genre}»`, `You like ${r.genre}`) }));
    }
    // фильмы/видео по жанру/категории, которую человек уже смотрел
    const watched = await query(
      `SELECT lower(m.genre) AS g FROM film_progress p JOIN film_movies m ON m.id=p.movie_id WHERE p.user_id=$1 AND m.genre<>'' GROUP BY lower(m.genre) ORDER BY max(p.updated_at) DESC LIMIT 3`, [ctx.id]);
    if (ctx.prime && watched.rows.length) {
      personal = true;
      const { rows } = await query(
        `SELECT m.id, m.title, m.genre, m.owner_id, m.age_restricted18 FROM film_movies m
          WHERE m.status='published' AND m.series_id IS NULL AND lower(m.genre) = ANY($2) AND NOT EXISTS (SELECT 1 FROM film_progress p WHERE p.user_id=$1 AND p.movie_id=m.id)
          ORDER BY m.views DESC LIMIT 12`, [ctx.id, watched.rows.map((r) => r.g)]);
      for (const r of rows) if (!r.age_restricted18 || ctx.adult) items.push(item('film', r.id, r.title, r.genre, { authorKey: authorKeyOf('film', r), reason: L('Похоже на то, что вы смотрели', 'Similar to what you watched') }));
    }
    const subs = await query(
      `SELECT v.id, v.title, v.owner_id FROM sky_videos v WHERE v.status='published' AND v.privacy='public'
          AND v.owner_id IN (SELECT following_id FROM follows WHERE follower_id=$1) AND NOT EXISTS (SELECT 1 FROM sky_video_progress p WHERE p.user_id=$1 AND p.video_id=v.id)
        ORDER BY v.published_at DESC NULLS LAST LIMIT 10`, [ctx.id]).catch(() => ({ rows: [] }));
    if (subs.rows.length) { personal = true; for (const r of subs.rows) items.push(item('video', r.id, r.title, '', { authorKey: authorKeyOf('video', r), reason: L('Автор, на которого вы подписаны', 'A creator you follow') })); }
    return { items, personal, reason: personal ? undefined : L('Недостаточно данных — показано популярное', 'Not enough data — showing popular items'), fallback: !personal };
  },

  async new(ctx) {
    const items = [];
    const [m, f, v] = await Promise.all([
      ctx.prime ? query(`SELECT id, title, artist, owner_id FROM music_tracks WHERE status='published' ORDER BY created_at DESC LIMIT 8`) : { rows: [] },
      ctx.prime ? query(`SELECT id, title, genre, owner_id, age_restricted18 FROM film_movies WHERE status='published' AND series_id IS NULL ORDER BY created_at DESC LIMIT 6`) : { rows: [] },
      query(`SELECT id, title, owner_id FROM sky_videos WHERE status='published' AND privacy='public' ORDER BY published_at DESC NULLS LAST LIMIT 6`),
    ]);
    m.rows.forEach((r) => items.push(item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r) })));
    f.rows.filter((r) => !r.age_restricted18 || ctx.adult).forEach((r) => items.push(item('film', r.id, r.title, r.genre, { authorKey: authorKeyOf('film', r) })));
    v.rows.forEach((r) => items.push(item('video', r.id, r.title, '', { authorKey: authorKeyOf('video', r) })));
    return { items, personal: false, reason: L('Свежие публикации', 'Fresh releases') };
  },

  async trending(ctx) {
    const items = [];
    const [m, f, v] = await Promise.all([
      ctx.prime ? query(`SELECT id, title, artist, owner_id FROM music_tracks WHERE status='published' ORDER BY plays DESC LIMIT 8`) : { rows: [] },
      ctx.prime ? query(`SELECT id, title, genre, owner_id, age_restricted18 FROM film_movies WHERE status='published' AND series_id IS NULL ORDER BY views DESC LIMIT 6`) : { rows: [] },
      query(`SELECT id, title, owner_id FROM sky_videos WHERE status='published' AND privacy='public' ORDER BY views DESC LIMIT 6`),
    ]);
    m.rows.forEach((r) => items.push(item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r) })));
    f.rows.filter((r) => !r.age_restricted18 || ctx.adult).forEach((r) => items.push(item('film', r.id, r.title, r.genre, { authorKey: authorKeyOf('film', r) })));
    v.rows.forEach((r) => items.push(item('video', r.id, r.title, '', { authorKey: authorKeyOf('video', r) })));
    return { items, personal: false, reason: L('По числу просмотров и прослушиваний', 'By views and plays') };
  },

  async similar(ctx) {
    if (!ctx.prime || !ctx.taste.artists.size) return { items: [] };
    const top = [...ctx.taste.artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
    const genres = ctx.taste.topGenres;
    if (!genres.length) return { items: [] };
    const { rows } = await query(
      `SELECT t.id, t.title, t.artist, t.owner_id FROM music_tracks t
        WHERE t.status='published' AND lower(t.genre) = ANY($2) AND lower(t.artist) <> ALL($3)
        ORDER BY t.plays DESC LIMIT 30`, [ctx.id, genres, top]);
    return { items: rows.map((r) => item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r) })), personal: true, reason: L('Тот же жанр, другие исполнители', 'Same genre, other artists') };
  },

  async discover(ctx) {
    if (!ctx.prime) return { items: [] };
    const known = [...ctx.taste.genres.keys()];
    const { rows } = await query(
      `SELECT t.id, t.title, t.artist, t.owner_id, t.genre FROM music_tracks t
        WHERE t.status='published' AND t.genre<>'' AND lower(t.genre) <> ALL($1)
          AND NOT EXISTS (SELECT 1 FROM music_history h WHERE h.user_id=$2 AND h.track_id=t.id)
        ORDER BY t.plays DESC LIMIT 30`, [known.length ? known : ['\u0000'], ctx.id]);
    return { items: rows.map((r) => item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r), reason: L(`Новый для вас жанр: ${r.genre}`, `New to you: ${r.genre}`) })), personal: known.length > 0, reason: known.length ? undefined : L('Популярное — вкус ещё не определён', 'Popular — your taste is not known yet') };
  },

  async evening(ctx) {
    if (!ctx.prime) return { items: [] };
    const { rows } = await query(`SELECT id, title, artist, owner_id, genre FROM music_tracks WHERE status='published' AND genre<>'' ORDER BY plays DESC LIMIT 200`);
    const calm = rows.filter((r) => CALM.test(r.genre)).slice(0, 24);
    return { items: calm.map((r) => item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r) })), personal: false, reason: L('Спокойные жанры (по названию жанра, звук не анализируется)', 'Calm genres (by genre name; audio is not analysed)') };
  },

  async short(ctx) {
    const items = [];
    const [v, e] = await Promise.all([
      query(`SELECT id, title, owner_id, duration_sec FROM sky_videos WHERE status='published' AND privacy='public' AND duration_sec BETWEEN 1 AND 600 ORDER BY views DESC LIMIT 8`),
      ctx.prime ? query(`SELECT e.id, e.title, e.duration_sec, p.owner_id FROM podcast_episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE p.status='published' AND e.published AND e.duration_sec BETWEEN 1 AND 900 ORDER BY e.created_at DESC LIMIT 6`) : { rows: [] },
    ]);
    v.rows.forEach((r) => items.push(item('video', r.id, r.title, `${Math.max(1, Math.round(r.duration_sec / 60))} ${L('мин', 'min')}`, { authorKey: authorKeyOf('video', r) })));
    e.rows.forEach((r) => items.push(item('podcast', r.id, r.title, `${Math.max(1, Math.round(r.duration_sec / 60))} ${L('мин', 'min')}`, { authorKey: authorKeyOf('podcast', r) })));
    return { items, personal: false, reason: L('До 10–15 минут', 'Up to 10–15 minutes') };
  },

  async collection(ctx) {
    const items = [];
    const [f, b, p] = await Promise.all([
      ctx.prime ? query(`SELECT m.id, m.title FROM film_saved s JOIN film_movies m ON m.id=s.movie_id WHERE s.user_id=$1 AND (m.status='published' OR m.owner_id=$1) ORDER BY s.created_at DESC LIMIT 8`, [ctx.id]) : { rows: [] },
      ctx.prime ? query(`SELECT b.id, b.title FROM book_shelf s JOIN books b ON b.id=s.book_id WHERE s.user_id=$1 AND (b.status='published' OR b.author_id=$1) ORDER BY s.created_at DESC LIMIT 8`, [ctx.id]) : { rows: [] },
      ctx.prime ? query(`SELECT p.id, p.title FROM podcast_subscriptions s JOIN podcasts p ON p.id=s.podcast_id WHERE s.user_id=$1 AND p.status='published' ORDER BY s.created_at DESC LIMIT 8`, [ctx.id]) : { rows: [] },
    ]);
    f.rows.forEach((r) => items.push(item('film', r.id, r.title, L('Сохранённое кино', 'Saved film'))));
    b.rows.forEach((r) => items.push(item('book', r.id, r.title, L('С вашей полки', 'On your shelf'))));
    p.rows.forEach((r) => items.push(item('podcast', r.id, r.title, L('Вы подписаны', 'Subscribed'))));
    return { items, personal: true, reason: L('То, что вы сохранили', 'What you saved') };
  },

  async together(ctx) {
    if (!ctx.prime) return { items: [] };
    const d = (await query(`SELECT id FROM music_duo WHERE (a_id=$1 OR b_id=$1) AND status='active' ORDER BY updated_at DESC LIMIT 1`, [ctx.id])).rows[0];
    if (!d) return { items: [] };
    const q = await duoQueue(ctx.id, d.id);
    if (q.error || !q.tracks?.length) return { items: [] };
    return { items: q.tracks.map((t) => item('music', t.id, t.title, t.artist, { authorKey: `m:${String(t.artist).toLowerCase()}`, reason: t.reason })), personal: true, reason: L(`Поток на двоих с ${q.partner?.name ?? 'другом'}`, `Duo flow with ${q.partner?.name ?? 'a friend'}`) };
  },

  async recent(ctx) {
    const items = [];
    const [m, b, p] = await Promise.all([
      ctx.prime ? query(`SELECT id, title, artist, owner_id FROM music_tracks WHERE status='published' ORDER BY created_at DESC LIMIT 6`) : { rows: [] },
      ctx.prime ? query(`SELECT id, title, author_id AS owner_id FROM books WHERE status='published' ORDER BY created_at DESC LIMIT 5`) : { rows: [] },
      ctx.prime ? query(`SELECT e.id, e.title, p.owner_id FROM podcast_episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE p.status='published' AND e.published ORDER BY e.created_at DESC LIMIT 5`) : { rows: [] },
    ]);
    m.rows.forEach((r) => items.push(item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r) })));
    b.rows.forEach((r) => items.push(item('book', r.id, r.title, '', { authorKey: authorKeyOf('book', r) })));
    p.rows.forEach((r) => items.push(item('podcast', r.id, r.title, '', { authorKey: authorKeyOf('podcast', r) })));
    return { items, personal: false, reason: L('Недавно добавлено в каталоги', 'Recently added to catalogs') };
  },

  async return(ctx) {
    if (!ctx.prime) return { items: [] };
    const { rows } = await query(
      `SELECT t.id, t.title, t.artist, t.owner_id FROM music_history h JOIN music_tracks t ON t.id=h.track_id
        WHERE h.user_id=$1 AND t.status='published' GROUP BY t.id HAVING count(*) >= 2 AND max(h.played_at) < now() - interval '14 days'
        ORDER BY max(h.played_at) DESC LIMIT 20`, [ctx.id]);
    return { items: rows.map((r) => item('music', r.id, r.title, r.artist, { authorKey: authorKeyOf('music', r) })), personal: true, reason: L('Слушали не раз, но давно', 'Played often, not lately') };
  },
};

const bumpStat = (shelf, field, ms) => query(
  `INSERT INTO wave_stats (day, shelf, ${field}, total_ms) VALUES (current_date, $1, 1, $2)
   ON CONFLICT (day, shelf) DO UPDATE SET ${field} = wave_stats.${field} + 1, total_ms = wave_stats.total_ms + $2`, [shelf, ms]).catch(() => {});

export const getAdminConfig = async () => {
  const { rows } = await query(`SELECT key, value FROM wave_admin`);
  const cfg = { disabled: [], editorial: [] };
  for (const r of rows) { if (r.key === 'disabled') cfg.disabled = Array.isArray(r.value) ? r.value : []; if (r.key === 'editorial') cfg.editorial = Array.isArray(r.value) ? r.value : []; }
  return cfg;
};

export const getPrefs = async (profileId) => {
  const r = (await query('SELECT hidden_shelves, shelf_order, personalize FROM wave_prefs WHERE profile_id=$1', [profileId])).rows[0];
  return { hidden: r?.hidden_shelves ?? [], order: r?.shelf_order ?? [], personalize: r?.personalize ?? true };
};

export const savePrefs = async (profileId, body = {}) => {
  const cur = await getPrefs(profileId);
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.map(String).filter((s) => SHELF_IDS.includes(s)))] : null);
  const hidden = ids(body.hidden) ?? cur.hidden; const order = ids(body.order) ?? cur.order;
  const personalize = typeof body.personalize === 'boolean' ? body.personalize : cur.personalize;
  await query(`INSERT INTO wave_prefs (profile_id, hidden_shelves, shelf_order, personalize) VALUES ($1,$2,$3,$4)
               ON CONFLICT (profile_id) DO UPDATE SET hidden_shelves=$2, shelf_order=$3, personalize=$4, updated_at=now()`, [profileId, hidden, order, personalize]);
  return { hidden, order, personalize };
};

/** Собирает подборки. `only` — id одной подборки (виджет «SkyWave» с выбранной подборкой). */
export const buildWave = async (profileId, { only } = {}) => {
  const [ent, adult, prefs, admin] = await Promise.all([entitlementsOf(profileId), adultOf(profileId), getPrefs(profileId), getAdminConfig()]);
  const personalize = prefs.personalize;
  const [fb, taste] = await Promise.all([loadFeedback(profileId), personalize ? loadTaste(profileId) : { genres: new Map(), artists: new Map(), total: 0, topGenres: [], signals: 0 }]);
  const ctx = { id: profileId, prime: ent.prime.active, adult, taste, fb };
  const titles = SHELF_TITLES();
  const wanted = only ? [only].filter((s) => SHELF_IDS.includes(s)) : SHELF_IDS;
  const order = [...prefs.order.filter((s) => wanted.includes(s)), ...wanted.filter((s) => !prefs.order.includes(s))];

  const keep = (it) => {
    if (fb.hidden.has(`${it.kind}:${it.id}`)) return false;
    if (it.authorKey && fb.muted.has(it.authorKey)) return false;
    return true;
  };
  const score = (it, i) => i - (fb.more.has(`${it.kind}:${it.id}`) || (it.authorKey && fb.more.has(`a:${it.authorKey}`)) ? PER : 0)
    + (fb.less.has(`${it.kind}:${it.id}`) || (it.authorKey && fb.less.has(`a:${it.authorKey}`)) ? PER : 0);

  const shelves = [];
  await Promise.all(order.map(async (id) => {
    if (admin.disabled.includes(id)) return;
    const t0 = Date.now();
    try {
      let r = await builders[id](ctx);
      if (!personalize && r.personal && id !== 'continue' && id !== 'collection') r = { ...r, personal: false };
      const items = (r.items ?? []).filter(keep).map((it, i) => ({ it, s: score(it, i) })).sort((a, b) => a.s - b.s).slice(0, PER).map((x) => x.it);
      if (!items.length) { void bumpStat(id, 'empty', Date.now() - t0); return; }
      void bumpStat(id, 'built', Date.now() - t0);
      shelves.push({ id, title: titles[id], personal: Boolean(r.personal), fallback: Boolean(r.fallback), reason: r.reason ?? '', items });
    } catch (e) {
      void bumpStat(id, 'errors', Date.now() - t0);
      console.error('[wave]', id, e.message);
    }
  }));
  shelves.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  // редакционные подборки администрации — отдельным блоком, всегда помечены как редакционные
  const editorial = only ? [] : admin.editorial.filter((e) => e && e.title && Array.isArray(e.items)).slice(0, 3).map((e) => ({ id: `ed:${String(e.id ?? e.title).slice(0, 40)}`, title: String(e.title).slice(0, 60), editorial: true, personal: false, items: e.items.slice(0, PER) }));
  return { shelves, editorial, hidden: prefs.hidden, order: prefs.order, personalize, prime: ctx.prime, signals: taste.signals };
};

/** Обратная связь. mute_author без authorKey не имеет смысла. */
export const sendFeedback = async (profileId, { kind, itemId, signal, authorKey } = {}) => {
  if (!KINDS.includes(kind) || !itemId || !['more', 'less', 'hide', 'mute_author'].includes(signal)) return { error: 'bad_request' };
  const ak = String(authorKey ?? '').slice(0, 120);
  if (signal === 'mute_author' && !ak) return { error: 'bad_request' };
  // «больше» отменяет «меньше» и наоборот
  if (signal === 'more' || signal === 'less') await query(`DELETE FROM wave_feedback WHERE profile_id=$1 AND kind=$2 AND item_id=$3 AND signal=$4`, [profileId, kind, String(itemId), signal === 'more' ? 'less' : 'more']);
  await query(`INSERT INTO wave_feedback (profile_id, kind, item_id, signal, author_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [profileId, kind, String(itemId).slice(0, 80), signal, ak]);
  return { ok: true };
};

export const clearFeedback = async (profileId) => { await query('DELETE FROM wave_feedback WHERE profile_id=$1', [profileId]); return { ok: true }; };

/** «Почему я это вижу?»: причина из подборки + сигналы, на которых она держится (без чужих данных). */
export const explain = async (profileId, shelfId, kind, itemId) => {
  const w = await buildWave(profileId, { only: shelfId });
  const sh = w.shelves[0]; const it = sh?.items.find((x) => x.kind === kind && x.id === String(itemId));
  if (!sh || !it) return { error: 'not_found' };
  return { reason: it.reason || sh.reason || '', personal: sh.personal, fallback: sh.fallback, signals: w.signals };
};

/** Диагностика для администрации: счётчики по подборкам за N дней. Личных данных нет. */
export const diagnostics = async (days = 7) => {
  const d = Math.max(1, Math.min(90, Math.floor(days) || 7));
  const { rows } = await query(`SELECT shelf, sum(built)::int AS built, sum(empty)::int AS empty, sum(errors)::int AS errors, CASE WHEN sum(built+empty+errors)>0 THEN (sum(total_ms)/sum(built+empty+errors))::int ELSE 0 END AS avg_ms
                                  FROM wave_stats WHERE day >= current_date - $1::int GROUP BY shelf ORDER BY shelf`, [d]);
  return { days: d, shelves: rows };
};

export const saveAdminConfig = async (actor, { disabled, editorial } = {}) => {
  if (Array.isArray(disabled)) {
    const v = disabled.map(String).filter((s) => SHELF_IDS.includes(s));
    await query(`INSERT INTO wave_admin (key, value, updated_by) VALUES ('disabled',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=now()`, [JSON.stringify(v), actor]);
  }
  if (Array.isArray(editorial)) {
    const v = editorial.slice(0, 5).map((e) => ({
      id: String(e?.id ?? '').slice(0, 40), title: String(e?.title ?? '').replace(/[<>]/g, '').trim().slice(0, 60),
      items: (Array.isArray(e?.items) ? e.items : []).slice(0, PER).filter((i) => KINDS.includes(i?.kind) && i?.id).map((i) => ({ kind: i.kind, id: String(i.id).slice(0, 80), title: String(i.title ?? '').slice(0, 120), sub: String(i.sub ?? '').slice(0, 120) })),
    })).filter((e) => e.title);
    await query(`INSERT INTO wave_admin (key, value, updated_by) VALUES ('editorial',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=now()`, [JSON.stringify(v), actor]);
  }
  return getAdminConfig();
};
