/**
 * Пересказ выпуска.
 *
 * Правило одно и оно главное: пересказ делается по расшифровке и
 * только по ней. Нет расшифровки — нет пересказа, и ручка так и
 * отвечает. Придумать содержание выпуска, которого нет в тексте, —
 * худшее, что здесь может случиться: человек поверит.
 *
 * Поэтому:
 *   • в модель уходит сам текст с отметками времени, а не название
 *     передачи и не описание — по описанию она сочинит правдоподобное;
 *   • разделы заданы заранее и одни и те же, а ответ принимается
 *     только разбираемый; всё лишнее отбрасывается;
 *   • каждая отметка времени сверяется с расшифровкой: время, которого
 *     в выпуске нет, выкидывается, а не показывается человеку;
 *   • готовый пересказ кладётся в базу и считается один раз на выпуск.
 *     Он одинаков для всех, потому что выпуск для всех один.
 *
 * Если расшифровка длиннее того, что помещается в один запрос, берётся
 * её начало, а пересказ помечается неполным — и экран об этом честно
 * пишет. Пересказывать вторую половину по догадке мы не станем.
 */
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { askModel, aiConfigured } from './ai.mjs';
import { config } from './config.mjs';
import { rateLimitPerHour } from './security.mjs';
import { visibleEpisode, readTranscript } from './podcasts.mjs';

/** Сколько знаков расшифровки уходит в один запрос. */
const MAX_INPUT_CHARS = 60_000;
/** Сколько новых пересказов сервер согласен считать за час — на всех. */
const MAX_NEW_PER_HOUR = Math.max(1, Number(process.env.AI_SUMMARIES_PER_HOUR) || 200);

const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, max);

/**
 * Разделы. Порядок и названия неизменны: человек привыкает к одному
 * виду, и «иногда по темам, иногда нет» читается как поломка.
 */
export const SUMMARY_SECTIONS = ['Кратко', 'Главное', 'По темам', 'Таймкоды', 'Для кого', 'Важные выводы'];

const SYSTEM = [
  'Ты составляешь пересказ выпуска подкаста по его расшифровке.',
  '',
  'Строгие правила:',
  '1. Опирайся ТОЛЬКО на текст расшифровки. Ничего не добавляй от себя.',
  '2. Если чего-то в расшифровке нет — не пиши об этом вовсе. Пустой раздел лучше выдуманного.',
  '3. Не оценивай выпуск и не советуй ничего от своего имени.',
  '4. Время в таймкодах бери из отметок расшифровки, не выдумывай.',
  '5. Пиши на языке расшифровки.',
  '',
  'Ответь ОДНИМ объектом JSON без пояснений и без разметки, по образцу:',
  '{',
  '  "short": "два-три предложения о чём выпуск",',
  '  "main": ["тезис", "тезис"],',
  '  "topics": [{"title": "тема", "text": "что о ней сказано"}],',
  '  "timecodes": [{"time": 125, "title": "о чём говорят с этой секунды"}],',
  '  "audience": "кому этот выпуск полезен, по содержанию",',
  '  "takeaways": ["вывод", "вывод"]',
  '}',
  '"time" — целое число секунд от начала выпуска.',
].join('\n');

/** Расшифровка в текст для модели: отметка времени и реплика. */
const asPrompt = (cues) => {
  const lines = [];
  let chars = 0;
  let cut = false;
  for (const c of cues) {
    const mm = Math.floor(c.start / 60);
    const ss = Math.floor(c.start % 60);
    const line = `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}] ${
      c.speaker ? `${c.speaker}: ` : ''}${c.text}`;
    if (chars + line.length > MAX_INPUT_CHARS) { cut = true; break; }
    lines.push(line);
    chars += line.length + 1;
  }
  return { text: lines.join('\n'), partial: cut, covered: lines.length };
};

/**
 * Разбор ответа модели.
 *
 * Принимается только то, что удалось разобрать и проверить. Отметки
 * времени сверяются с длиной выпуска: модель иногда ставит время,
 * которого в выпуске нет, и показать его — значит отправить человека
 * в пустоту.
 */
const parseAnswer = (raw, maxTime) => {
  const body = String(raw ?? '').trim()
    // Модель порой оборачивает ответ в тройные кавычки — снимаем обёртку.
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let data;
  try { data = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  if (!data || typeof data !== 'object') return null;

  const list = (v, max, map) => (Array.isArray(v) ? v : []).slice(0, max).map(map).filter(Boolean);

  const out = {
    short: clean(data.short, 1200),
    main: list(data.main, 12, (x) => clean(x, 400) || null),
    topics: list(data.topics, 12, (x) => {
      const title = clean(x?.title, 200);
      const text = clean(x?.text, 900);
      return title || text ? { title, text } : null;
    }),
    timecodes: list(data.timecodes, 40, (x) => {
      const time = Math.trunc(Number(x?.time));
      const title = clean(x?.title, 200);
      if (!Number.isFinite(time) || time < 0 || time > maxTime || !title) return null;
      return { time, title };
    }).sort((a, b) => a.time - b.time),
    audience: clean(data.audience, 600),
    takeaways: list(data.takeaways, 12, (x) => clean(x, 400) || null),
  };

  // Пустой со всех сторон пересказ не пересказ: лучше честный отказ.
  const empty = !out.short && out.main.length === 0 && out.topics.length === 0
    && out.takeaways.length === 0;
  return empty ? null : out;
};

/**
 * Один и тот же выпуск часто открывают сразу несколько человек. Без
 * этой карты каждый из них позвал бы модель отдельно — и заплатили бы
 * мы за один и тот же текст столько раз, сколько было открытий.
 */
const running = new Map();

const readCached = async (episodeId, cueCount) => {
  const { rows } = await query(
    'SELECT body_enc, model, cue_count, created_at FROM podcast_summaries WHERE episode_id = $1',
    [episodeId]);
  const row = rows[0];
  if (!row) return null;
  // Расшифровку заменили — прежний пересказ сделан по другому тексту.
  if (Number(row.cue_count) !== cueCount) return null;
  try {
    const body = JSON.parse(decryptContent(row.body_enc) ?? '');
    return { ...body, model: row.model, createdAt: row.created_at?.toISOString?.() };
  } catch {
    return null;
  }
};

/**
 * Готовый пересказ выпуска, если он есть.
 * Ничего не считает и в модель не ходит — только смотрит в базу.
 */
export const getSummary = async (episodeId, viewerId) => {
  const row = await visibleEpisode(episodeId, viewerId);
  if (!row) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM podcast_cues WHERE episode_id = $1', [episodeId]);
  const cueCount = rows[0]?.n ?? 0;
  const cached = await readCached(episodeId, cueCount);
  if (cached) return { summary: cached, cached: true };
  return {
    summary: null,
    canBuild: cueCount > 0 && aiConfigured(),
    // Честная причина вместо пустого экрана: расшифровки нет или
    // языковая модель на этом сервере не настроена.
    reason: cueCount === 0 ? 'no_transcript' : (aiConfigured() ? null : 'ai_not_configured'),
  };
};

/**
 * Сделать пересказ. Если он уже есть и соответствует расшифровке —
 * возвращается прежний, без обращения к модели.
 */
export const buildSummary = async (episodeId, viewerId) => {
  const row = await visibleEpisode(episodeId, viewerId);
  if (!row) return { error: 'not_found' };

  const cues = await readTranscript(episodeId, viewerId);
  if (!cues || cues.length === 0) return { error: 'no_transcript' };

  const cached = await readCached(episodeId, cues.length);
  if (cached) return { summary: cached, cached: true };
  if (!aiConfigured()) return { error: 'ai_not_configured' };

  if (running.has(episodeId)) return running.get(episodeId);

  // Потолок на весь сервер, а не только на человека.
  //
  // Просить пересказ может любой, кому виден выпуск, — и это правильно:
  // пересказ один на выпуск и считается один раз. Но личный предел
  // ограничивает одного человека, а платит за всех владелец сервера.
  // Поэтому есть и общий счёт: даже если просящих много, за час
  // наберётся не больше этого числа новых пересказов.
  if (!rateLimitPerHour('podcast:summary:all', MAX_NEW_PER_HOUR)) return { error: 'ai_busy' };

  const work = (async () => {
    const { text, partial, covered } = asPrompt(cues);
    // Потолок времени — по самой расшифровке, а не по полю длительности:
    // длительность проставляет автор, и она бывает неверной.
    const maxTime = Math.ceil(Math.max(
      Number(row.duration_sec ?? 0),
      cues[cues.length - 1]?.end ?? 0,
    )) + 5;

    const answer = await askModel({
      system: SYSTEM,
      user: `Расшифровка выпуска${partial ? ' (начало; расшифровка длиннее)' : ''}:\n\n${text}`,
      maxTokens: 3000,
    });
    if (answer.error) return { error: answer.error };

    const parsed = parseAnswer(answer.text, maxTime);
    if (!parsed) return { error: 'ai_failed' };

    const body = {
      ...parsed,
      partial,
      // Сколько реплик попало в пересказ — чтобы «неполный» был не
      // словом, а числом.
      coveredCues: covered,
      totalCues: cues.length,
    };
    await query(
      `INSERT INTO podcast_summaries (episode_id, body_enc, model, cue_count)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (episode_id) DO UPDATE
         SET body_enc = EXCLUDED.body_enc, model = EXCLUDED.model,
             cue_count = EXCLUDED.cue_count, created_at = now()`,
      [episodeId, encryptContent(JSON.stringify(body)), config.aiModel, cues.length]);

    return { summary: { ...body, model: config.aiModel, createdAt: new Date().toISOString() } };
  })().finally(() => running.delete(episodeId));

  running.set(episodeId, work);
  return work;
};

/** Убрать пересказ — чтобы сделать заново. Только автору выпуска. */
export const dropSummary = async (episodeId, actorId) => {
  const row = await visibleEpisode(episodeId, actorId);
  if (!row || row.own !== true) return { error: 'not_allowed' };
  await query('DELETE FROM podcast_summaries WHERE episode_id = $1', [episodeId]);
  return { ok: true };
};
