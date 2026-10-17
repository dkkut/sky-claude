/**
 * Голосовой поиск музыки (Sky Smart Speaker и голосовые команды Sky AI).
 *
 * Не вторая музыкальная база: те же `music_tracks`, `music_playlists`, избранное и история. Здесь только
 * разбор названия «как сказал человек» — с опечатками, транслитом, ё/е, псевдонимами и совпадающими названиями —
 * и ответ «что включить» либо «уточните, какой из вариантов». Файлы и пропуска выдаёт обычный /api/music/*.
 *
 * Доступ: решает сервер (маршрут проверяет Prime так же, как весь /api/music). Выбираются только то, что человек вправе видеть
 * (опубликованное + своё). Содержимое запроса в журнал не пишется.
 */
import { query } from './db.mjs';
import { toTrack, listFavorites, listHistory, listPlaylists, readPlaylist } from './music.mjs';

/* ─── Нормализация и сходство ─────────────────────────────────────── */

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

/** Привести строку к виду для сравнения: регистр, ё→е, без знаков, лишних пробелов. */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Кириллица → латиница: чтобы «Земфира» и «Zemfira» оказались рядом. */
export const translit = (s) => norm(s).replace(/[а-я]/g, (c) => TRANSLIT[c] ?? c)
  // типичные расхождения английского написания: x/ks, w/v, j/zh/dzh, c/k, y/i
  .replace(/ks/g, 'x').replace(/w/g, 'v').replace(/ph/g, 'f').replace(/c(?![h])/g, 'k').replace(/y/g, 'i').replace(/(.)\1+/g, '$1');

const lev = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
const ratio = (a, b) => (a || b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1);

/**
 * Сходство запроса и названия: 0..1. Точное совпадение — 1; «название содержит запрос» и наоборот — высокое;
 * иначе — по словам с допуском на опечатки (лучшее из исходного написания и транслита).
 */
export const similarity = (query_, candidate) => {
  const forms = (x) => [norm(x), translit(x)];
  const [qa, qt] = forms(query_); const [ca, ct] = forms(candidate);
  if (!qa || !ca) return 0;
  let best = 0;
  for (const [q, c] of [[qa, ca], [qt, ct], [qa, ct], [qt, ca]]) {
    if (!q || !c) continue;
    if (q === c) return 1;
    let s = ratio(q, c);
    if (c.includes(q) || q.includes(c)) s = Math.max(s, 0.82 + 0.15 * Math.min(q.length, c.length) / Math.max(q.length, c.length));
    const qw = q.split(' '); const cw = c.split(' ');
    const hit = qw.filter((w) => cw.some((x) => x === w || (w.length > 3 && ratio(w, x) >= 0.8))).length;
    if (qw.length) s = Math.max(s, 0.9 * (hit / qw.length) * Math.min(1, qw.length / Math.max(1, Math.min(cw.length, qw.length + 1)) + 0.4));
    best = Math.max(best, s);
  }
  return Math.min(1, best);
};

/* ─── Каталог ─────────────────────────────────────────────────────── */

const CATALOG_LIMIT = 4000;
const visibleCatalog = async (profileId) => {
  const { rows } = await query(
    `SELECT *, owner_id = $1 AS own FROM music_tracks
      WHERE status = 'published' OR owner_id = $1
      ORDER BY plays DESC NULLS LAST, created_at DESC LIMIT ${CATALOG_LIMIT}`, [profileId]);
  return rows;
};

const aliasesFor = async (qNorm) => {
  const { rows } = await query('SELECT artist_norm FROM music_artist_aliases WHERE alias_norm = $1 OR alias_norm = $2', [qNorm, translit(qNorm)]);
  return rows.map((r) => r.artist_norm);
};

/** «Что-нибудь спокойное» и т. п.: настроение → слова жанра/названия. Расширяется добавлением строки. */
export const MOODS = [
  { words: /спокойн|расслаб|тихо|для сна|chill|relax|calm/i, label: 'спокойное', genres: ['ambient', 'chill', 'lofi', 'lo-fi', 'acoustic', 'classical', 'jazz', 'инструментал', 'классик', 'эмбиент', 'акустик', 'джаз', 'релакс'] },
  { words: /бодр|энергич|для спорта|трениров|драйв|веселое|весёлое|energ|upbeat/i, label: 'бодрое', genres: ['dance', 'electronic', 'edm', 'pop', 'rock', 'hip', 'танц', 'поп', 'рок', 'электрон'] },
  { words: /груст|печальн|sad/i, label: 'грустное', genres: ['blues', 'indie', 'ballad', 'балад', 'блюз', 'инди'] },
  { words: /для работы|сосредоточ|focus|study|учёб|учеб/i, label: 'для работы', genres: ['ambient', 'lofi', 'lo-fi', 'classical', 'instrumental', 'инструментал', 'классик'] },
];

const pickDistinct = (arr, n) => arr.slice(0, n);

/* ─── Основная функция ────────────────────────────────────────────── */

const SURE = 0.86;       // выше — выбор однозначный
const CLOSE = 0.12;      // разрыв между первым и вторым, при котором «однозначно»

/**
 * Разобрать запрос и вернуть, что включить.
 * kind: any | track | artist | album | playlist | mood | any_music | favorites
 * Ответ: { intent, items[], choices[]?, label, reason? }
 *  - items — очередь для плеера (уже готовая, в порядке воспроизведения);
 *  - choices — если вариантов несколько и выбрать за человека нельзя.
 */
export const resolveVoice = async (profileId, { q, kind = 'any' } = {}) => {
  const raw = String(q ?? '').slice(0, 120);
  const qn = norm(raw);
  const trackView = (r) => ({ ...toTrack(r), album: r.album || undefined });

  if (kind === 'any_music' || (!qn && kind === 'any')) {
    const fav = await listFavorites(profileId);
    const base = fav.length ? fav : await listHistory(profileId);
    if (base.length) return { intent: 'any_music', label: fav.length ? 'избранное' : 'недавнее', items: base.slice(0, 50) };
    const cat = await visibleCatalog(profileId);
    return cat.length ? { intent: 'any_music', label: 'популярное', items: cat.slice(0, 30).map(trackView) } : { intent: 'any_music', items: [], reason: 'empty_catalog' };
  }
  if (!qn && kind !== 'favorites') return { intent: kind, items: [], reason: 'empty_query' };

  if (kind === 'favorites') {
    const fav = await listFavorites(profileId);
    return fav.length ? { intent: 'favorites', label: 'избранное', items: fav.slice(0, 100) } : { intent: 'favorites', items: [], reason: 'no_favorites' };
  }

  if (kind === 'playlist') {
    const lists = await listPlaylists(profileId);
    if (!lists.length) return { intent: 'playlist', items: [], reason: 'no_playlists' };
    const scored = qn && !/^(мо[йё]|мои|мой плейлист|плейлист)$/.test(qn) ? lists.map((p) => ({ p, s: similarity(qn.replace(/^(мо[йё]|мои)\s+/, '').replace(/плейлист\s*/, ''), p.name) })).sort((a, b) => b.s - a.s) : null;
    let chosen = null;
    if (!scored) { if (lists.length === 1) chosen = lists[0]; else return { intent: 'playlist', items: [], choices: lists.slice(0, 6).map((p) => ({ type: 'playlist', id: p.id, title: p.name, sub: `${p.count} треков` })) }; }
    else if (scored[0].s >= 0.7 && (scored.length === 1 || scored[0].s - scored[1].s >= CLOSE)) chosen = scored[0].p;
    else if (scored[0].s >= 0.5) return { intent: 'playlist', items: [], choices: scored.filter((x) => x.s >= 0.5).slice(0, 5).map(({ p }) => ({ type: 'playlist', id: p.id, title: p.name, sub: `${p.count} треков` })) };
    if (!chosen) return { intent: 'playlist', items: [], reason: 'not_found' };
    const full = await readPlaylist(chosen.id, profileId);
    return full?.tracks?.length ? { intent: 'playlist', label: chosen.name, items: full.tracks } : { intent: 'playlist', items: [], reason: 'empty_playlist' };
  }

  const cat = await visibleCatalog(profileId);

  if (kind === 'mood' || (kind === 'any' && MOODS.some((m) => m.words.test(raw)))) {
    const mood = MOODS.find((m) => m.words.test(raw));
    if (!mood) return { intent: 'mood', items: [], reason: 'unknown_mood' };
    const pick = cat.filter((r) => mood.genres.some((g) => norm(r.genre).includes(g) || norm(r.title).includes(g)));
    return pick.length ? { intent: 'mood', label: mood.label, items: pickDistinct(pick, 40).map(trackView) } : { intent: 'mood', label: mood.label, items: [], reason: 'no_match' };
  }

  const aliasArtists = await aliasesFor(qn);
  const score = (r) => {
    const t = similarity(qn, r.title); const a = similarity(qn, r.artist);
    const alb = r.album ? similarity(qn, r.album) : 0;
    const aliasHit = aliasArtists.some((x) => norm(r.artist) === x) ? 0.95 : 0;
    const combo = similarity(qn, `${r.artist} ${r.title}`);
    return { track: Math.max(t, combo), artist: Math.max(a, aliasHit), album: alb };
  };
  const rows = cat.map((r) => ({ r, s: score(r) }));

  // Исполнитель: сводим треки по имени
  const byArtist = new Map();
  for (const x of rows) { const k = norm(x.r.artist); const cur = byArtist.get(k); if (!cur || x.s.artist > cur.s) byArtist.set(k, { name: x.r.artist, s: x.s.artist, tracks: [...(cur?.tracks ?? []), x.r] }); else cur.tracks.push(x.r); }
  const artists = [...byArtist.values()].sort((a, b) => b.s - a.s);
  const albums = new Map();
  for (const x of rows) if (x.r.album) { const k = `${norm(x.r.artist)}|${norm(x.r.album)}`; const cur = albums.get(k) ?? { name: x.r.album, artist: x.r.artist, s: x.s.album, tracks: [] }; cur.tracks.push(x.r); albums.set(k, cur); }
  const albumList = [...albums.values()].sort((a, b) => b.s - a.s);
  const tracksSorted = [...rows].sort((a, b) => b.s.track - a.s.track);

  const decide = (list, getS, mk) => {
    const top = list.filter((x) => getS(x) >= 0.6).slice(0, 5);
    if (!top.length) return null;
    if (getS(top[0]) >= SURE && (top.length === 1 || getS(top[0]) - getS(top[1]) >= CLOSE)) return { chosen: top[0] };
    return { choices: top.map(mk) };
  };

  if (kind === 'artist') {
    const d = decide(artists, (x) => x.s, (a) => ({ type: 'artist', id: norm(a.name), title: a.name, sub: `${a.tracks.length} треков` }));
    if (!d) return { intent: 'artist', items: [], reason: 'not_found' };
    if (d.choices) return { intent: 'artist', items: [], choices: d.choices };
    return { intent: 'artist', label: d.chosen.name, items: d.chosen.tracks.sort((a, b) => Number(b.plays ?? 0) - Number(a.plays ?? 0)).slice(0, 50).map(trackView) };
  }
  if (kind === 'album') {
    const d = decide(albumList, (x) => x.s, (a) => ({ type: 'album', id: `${norm(a.artist)}|${norm(a.name)}`, title: a.name, sub: a.artist }));
    if (!d) return { intent: 'album', items: [], reason: 'not_found' };
    if (d.choices) return { intent: 'album', items: [], choices: d.choices };
    return { intent: 'album', label: d.chosen.name, items: d.chosen.tracks.map(trackView) };
  }
  if (kind === 'track') {
    const d = decide(tracksSorted, (x) => x.s.track, (x) => ({ type: 'track', id: x.r.id, title: x.r.title, sub: x.r.artist }));
    if (!d) return { intent: 'track', items: [], reason: 'not_found' };
    if (d.choices) return { intent: 'track', items: [], choices: d.choices };
    return { intent: 'track', label: d.chosen.r.title, items: [trackView(d.chosen.r)] };
  }

  // «Включи X» без указания, что это: сравниваем лучший трек, исполнителя и альбом
  const bestTrack = tracksSorted[0]; const bestArtist = artists[0]; const bestAlbum = albumList[0];
  const cands = [
    bestTrack && { type: 'track', s: bestTrack.s.track, v: bestTrack },
    bestArtist && { type: 'artist', s: bestArtist.s * 0.98, v: bestArtist },
    bestAlbum && { type: 'album', s: bestAlbum.s * 0.97, v: bestAlbum },
  ].filter(Boolean).sort((a, b) => b.s - a.s);
  if (!cands.length || cands[0].s < 0.6) return { intent: 'any', items: [], reason: 'not_found' };
  const top = cands[0];
  if (top.type === 'track') {
    const same = tracksSorted.filter((x) => x.s.track >= top.s - CLOSE && x.s.track >= 0.6).slice(0, 5);
    // совпадающие названия у разных исполнителей — спрашиваем
    const distinct = new Map(); for (const x of same) distinct.set(`${norm(x.r.title)}|${norm(x.r.artist)}`, x);
    if (distinct.size > 1) return { intent: 'track', items: [], choices: [...distinct.values()].map((x) => ({ type: 'track', id: x.r.id, title: x.r.title, sub: x.r.artist })) };
    return { intent: 'track', label: top.v.r.title, items: [trackView(top.v.r)] };
  }
  if (top.type === 'artist') return { intent: 'artist', label: top.v.name, items: top.v.tracks.sort((a, b) => Number(b.plays ?? 0) - Number(a.plays ?? 0)).slice(0, 50).map(trackView) };
  return { intent: 'album', label: top.v.name, items: top.v.tracks.map(trackView) };
};

/** Выбор из предложенных вариантов (после «уточните»). Права проверяются заново — как при обычном запросе. */
export const resolveChoice = async (profileId, { type, id } = {}) => {
  const cat = await visibleCatalog(profileId);
  const view = (r) => toTrack(r);
  if (type === 'track') { const r = cat.find((x) => x.id === id); return r ? { intent: 'track', label: r.title, items: [view(r)] } : { intent: 'track', items: [], reason: 'not_found' }; }
  if (type === 'artist') { const rs = cat.filter((x) => norm(x.artist) === String(id)); return rs.length ? { intent: 'artist', label: rs[0].artist, items: rs.slice(0, 50).map(view) } : { intent: 'artist', items: [], reason: 'not_found' }; }
  if (type === 'album') { const rs = cat.filter((x) => x.album && `${norm(x.artist)}|${norm(x.album)}` === String(id)); return rs.length ? { intent: 'album', label: rs[0].album, items: rs.map(view) } : { intent: 'album', items: [], reason: 'not_found' }; }
  if (type === 'playlist') { const full = await readPlaylist(String(id), profileId); return full?.tracks?.length ? { intent: 'playlist', label: full.name, items: full.tracks } : { intent: 'playlist', items: [], reason: 'not_found' }; }
  return { intent: 'any', items: [], reason: 'bad_type' };
};
