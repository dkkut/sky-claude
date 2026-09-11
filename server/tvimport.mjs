/**
 * Разбор плейлиста M3U.
 *
 * Плейлист — файл, полученный снаружи, и относиться к нему надо как к
 * любому чужому вводу: в нём бывает что угодно, включая нарочно
 * составленные строки. Поэтому разбор здесь намеренно скучный —
 * никаких регулярных выражений по всему файлу, никакого доверия к
 * порядку строк, жёсткие потолки на размер и количество.
 *
 * Ничего не записывается: этот файл только разбирает и раскладывает.
 * Записью занимается attachSource в tv.mjs, и она заново проверяет
 * каждый адрес — узел в белом списке, имя разрешается в обычные
 * адреса. Загрузчик не может обойти эту проверку, потому что не
 * пишет в базу сам.
 */

/** Больше плейлист не бывает, а мегабайтные — это уже не плейлист. */
export const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
/** Столько записей за один заход. */
const MAX_ENTRIES = 1000;

const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/** Значение свойства вида ключ="значение" из строки #EXTINF. */
const attr = (line, name) => {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(line);
  return m ? clean(m[1], 300) : '';
};

/**
 * Разложить плейлист на записи.
 *
 * Формат простой: строка #EXTINF описывает канал, следующая непустая
 * строка без решётки — адрес. Всё остальное пропускаем, в том числе
 * строки #EXTINF без адреса за ними: такая запись ничего не значит.
 */
export const parsePlaylist = (raw) => {
  const text = String(raw ?? '').slice(0, MAX_PLAYLIST_BYTES);
  const lines = text.split(/\r?\n/);
  const out = [];
  let pending = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (/^#EXTINF/i.test(t)) {
      // Название идёт после последней запятой в строке.
      const comma = t.lastIndexOf(',');
      pending = {
        name: comma >= 0 ? clean(t.slice(comma + 1), 120) : '',
        tvgName: attr(t, 'tvg-name'),
        tvgId: attr(t, 'tvg-id'),
        logo: attr(t, 'tvg-logo'),
        group: attr(t, 'group-title'),
        country: attr(t, 'tvg-country').slice(0, 8),
      };
      continue;
    }
    if (t.startsWith('#')) continue;

    if (pending) {
      const name = pending.name || pending.tvgName || pending.tvgId;
      if (name) out.push({ ...pending, name, url: clean(t, 2000) });
      pending = null;
      if (out.length >= MAX_ENTRIES) break;
    }
  }
  return out;
};

/**
 * Раздел Sky TV по подсказке из плейлиста.
 *
 * Плейлисты складывают каналы в свои группы, и совпадения с нашими
 * разделами там нет. Угадываем по знакомым словам, а всё незнакомое
 * честно кладём в «Разное» — лучше так, чем разложить наугад.
 */
export const guessCategory = (entry) => {
  const s = `${entry.group} ${entry.name}`.toLowerCase();
  if (/новост|news|вест|24/.test(s)) return 'Новости';
  if (/спорт|sport|матч|футбол/.test(s)) return 'Спорт';
  if (/дет|kids|мульт|карусель/.test(s)) return 'Детские';
  if (/музык|music|муз-тв|шансон/.test(s)) return 'Музыка';
  if (/кино|film|movie|синема/.test(s)) return 'Кино';
  if (/культур|наук|истор|познават|discovery|док/.test(s)) return 'Познавательные';
  if (/регион|обл|край|гтрк/.test(s)) return 'Региональные';
  if (/развлек|entertain/.test(s)) return 'Развлекательные';
  return 'Разное';
};

/** Короткое имя канала для команд на сервере. */
export const slugFor = (entry) => {
  const base = (entry.tvgId || entry.name || '')
    .toLowerCase()
    .replace(/\.(ru|com|tv)$/i, '')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || null;
};

/**
 * Почему запись нельзя подключить — до всякого обращения к сети.
 *
 * Это не дубликат проверки из tvsource.mjs, а её быстрая часть:
 * пройтись по сотне записей, не дёргая службу имён на каждой. Сама
 * проверка всё равно случится при записи.
 */
export const preflight = (entry, allowedHosts) => {
  let u;
  try { u = new URL(entry.url); } catch { return 'адрес не разобрать'; }

  if (u.protocol !== 'https:') return 'не https — эфир можно подменить по дороге';
  if (u.username || u.password) return 'учётные данные внутри адреса';
  if (u.port && u.port !== '443') return `необычный порт ${u.port}`;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.includes(':')) {
    return 'голый адрес вместо имени';
  }
  // Встраивания чужих проигрывателей — это не поток: наш плеер их не
  // откроет, и подключать их нечего.
  if (/(^|\.)(youtube\.com|youtu\.be|ok\.ru|vk\.com|rutube\.ru|dailymotion\.com)$/i.test(u.hostname)) {
    return 'это страница с чужим проигрывателем, а не поток';
  }
  if (!/\.(m3u8|mpd)(\?|$)/i.test(u.pathname + u.search)) return 'не похоже на манифест';

  const host = u.hostname.toLowerCase();
  const allowed = (allowedHosts ?? []).some((a) => host === a || host.endsWith(`.${a}`));
  if (!allowed) return `узел ${host} не разрешён`;

  return null;
};

/** Формат по расширению манифеста. */
export const kindFor = (entry) => (/\.mpd(\?|$)/i.test(entry.url) ? 'dash' : 'hls');

/**
 * Разложить плейлист на «можно подключить» и «пропущено, потому что».
 * Ничего не записывает — решение принимает тот, кто вызвал.
 */
export const planImport = (raw, allowedHosts) => {
  const entries = parsePlaylist(raw);
  const ready = [];
  const skipped = [];
  const seen = new Set();

  for (const e of entries) {
    const slug = slugFor(e);
    if (!slug) { skipped.push({ name: e.name || '—', why: 'нет имени' }); continue; }
    const why = preflight(e, allowedHosts);
    if (why) { skipped.push({ name: e.name, host: hostOf(e.url), why }); continue; }
    // Один канал — один источник за заход: в плейлистах дубли обычны.
    if (seen.has(slug)) { skipped.push({ name: e.name, why: 'уже встречался выше' }); continue; }
    seen.add(slug);
    ready.push({
      slug,
      name: e.name,
      category: guessCategory(e),
      country: e.country || 'RU',
      url: e.url,
      kind: kindFor(e),
      host: hostOf(e.url),
    });
  }
  return { ready, skipped, total: entries.length };
};

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return '—'; } };
