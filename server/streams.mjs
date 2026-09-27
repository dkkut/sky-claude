/**
 * Sky Трансляции — реестр эфиров, зрителей, чата, реакций, прогнозов
 * и донатов.
 *
 * Метаданные эфира и донаты — в базе (миграция 089), переживают
 * перезапуск и видны всем. Кто прямо сейчас смотрит, что происходит в
 * чате, какие есть реакции/прогнозы — живое состояние в памяти этого
 * модуля, тем же приёмом, что и в server/voiceparty.mjs: это меняется
 * много раз в секунду и обнуляется вместе с концом эфира, писать это
 * на диск при каждом сообщении незачем.
 *
 * WebRTC сам (offer/answer/ICE) сюда не входит — сигналинг живёт в
 * server/signal.mjs (case 'live:*'), этот модуль только решает, кто
 * сейчас смотрит эфир (значит, кому можно сигналить и рассылать
 * live-обновления) и хранит то, что должно быть видно всем.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';

export const CATEGORIES = ['gaming', 'talk', 'music', 'creative', 'sport', 'irl', 'other'];
export const REACTIONS = ['❤️', '🔥', '😂', '👏', '😮'];
const MAX_CHAT = 200;

const newId = () => `live-${generateId()}`;

/** streamId -> Map<profileId, joinedAt> — живые зрители. */
const viewers = new Map();
/** streamId -> StreamChatMsg[] (капнуто на MAX_CHAT, только для активного эфира). */
const chatLog = new Map();
/** streamId -> Record<emoji, count>. */
const reactions = new Map();
/** streamId -> StreamPrediction[]. */
const predictions = new Map();

export const viewerIds = (streamId) => [...(viewers.get(streamId)?.keys() ?? [])];
export const isViewer = (streamId, profileId) => viewers.get(streamId)?.has(profileId) ?? false;

const clearLiveState = (streamId) => {
  viewers.delete(streamId);
  chatLog.delete(streamId);
  reactions.delete(streamId);
  predictions.delete(streamId);
};

const profilesById = async (ids) => {
  if (!ids.length) return new Map();
  const { rows } = await query('SELECT id, name, username, avatar FROM profiles WHERE id = ANY($1)', [ids]);
  return new Map(rows.map((r) => [r.id, r]));
};

const toStreamView = async (row) => {
  const [author] = [...(await profilesById([row.author_id])).values()];
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: author?.name ?? 'Пользователь',
    authorUsername: author?.username,
    authorAvatar: author?.avatar ?? null,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: row.tags,
    source: row.source,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ended: row.ended_at != null,
    peakViewers: row.peak_viewers,
    viewerCount: viewerIds(row.id).length,
    totalDonationsPoints: Number(row.total_donations_points),
    chat: chatLog.get(row.id) ?? [],
    reactions: reactions.get(row.id) ?? {},
    predictions: predictions.get(row.id) ?? [],
  };
};

export const listLive = async () => {
  const { rows } = await query(
    `SELECT * FROM live_streams WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 200`,
  );
  return Promise.all(rows.map(toStreamView));
};

export const getStream = async (streamId) => {
  const { rows } = await query('SELECT * FROM live_streams WHERE id = $1', [streamId]);
  if (!rows[0]) return null;
  return toStreamView(rows[0]);
};

const getRawStream = async (streamId) => {
  const { rows } = await query('SELECT * FROM live_streams WHERE id = $1', [streamId]);
  return rows[0] ?? null;
};

export const createStream = async (authorId, input = {}) => {
  const title = String(input.title ?? '').trim().slice(0, 80);
  if (title.length < 2) return { error: 'invalid_title' };
  const description = String(input.description ?? '').trim().slice(0, 300);
  const category = CATEGORIES.includes(input.category) ? input.category : 'other';
  const source = ['camera', 'screen'].includes(input.source) ? input.source : 'camera';
  const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 24)).slice(0, 8) : [];

  const id = newId();
  try {
    const { rows } = await query(
      `INSERT INTO live_streams (id, author_id, title, description, category, source, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
      [id, authorId, title, description, category, source, JSON.stringify(tags)],
    );
    viewers.set(id, new Map());
    chatLog.set(id, []);
    reactions.set(id, {});
    predictions.set(id, []);
    return { stream: await toStreamView(rows[0]) };
  } catch (err) {
    if (err.code === '23505') return { error: 'already_live' };
    throw err;
  }
};

export const endStream = async (authorId, streamId) => {
  const row = await getRawStream(streamId);
  if (!row || row.ended_at) return { error: 'not_found' };
  if (row.author_id !== authorId) return { error: 'not_allowed' };
  await query('UPDATE live_streams SET ended_at = now() WHERE id = $1', [streamId]);
  const audience = viewerIds(streamId);
  clearLiveState(streamId);
  if (audience.length) {
    const { pushLive } = await import('./signal.mjs');
    pushLive(audience, { type: 'live:ended', payload: { streamId } });
  }
  return { ok: true };
};

/** Автор ушёл оффлайн целиком (закрыл вкладку/потерял связь) — эфир
 *  без источника видео продолжаться не может. Список зрителей снимается
 *  ДО очистки живого состояния и возвращается вместе с id — иначе
 *  вызывающему коду неоткуда было бы узнать, кого оповещать: сама
 *  функция тут же удаляет эфир из памяти. */
export const endStreamsByDisconnect = async (profileId) => {
  const { rows } = await query(
    `UPDATE live_streams SET ended_at = now() WHERE author_id = $1 AND ended_at IS NULL RETURNING id`,
    [profileId],
  );
  return rows.map((r) => {
    const ids = viewerIds(r.id);
    clearLiveState(r.id);
    return { id: r.id, viewerIds: ids };
  });
};

export const isBanned = async (streamId, profileId) => {
  const { rows } = await query(
    'SELECT 1 FROM live_stream_bans WHERE stream_id = $1 AND profile_id = $2', [streamId, profileId],
  );
  return rows.length > 0;
};

export const ban = async (authorId, streamId, targetId) => {
  const row = await getRawStream(streamId);
  if (!row) return { error: 'not_found' };
  if (row.author_id !== authorId) return { error: 'not_allowed' };
  await query('INSERT INTO live_stream_bans (stream_id, profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [streamId, targetId]);
  viewers.get(streamId)?.delete(targetId);
  return { ok: true };
};

/** Встать зрителем. Возвращает {stream} с недавним чатом/реакциями/
 *  прогнозами или {error}. */
export const join = async (profileId, streamId) => {
  const row = await getRawStream(streamId);
  if (!row || row.ended_at) return { error: 'not_found' };
  if (await isBanned(streamId, profileId)) return { error: 'banned' };

  let map = viewers.get(streamId);
  if (!map) { map = new Map(); viewers.set(streamId, map); }
  if (!map.has(profileId)) map.set(profileId, new Date().toISOString());

  const count = map.size;
  if (count > row.peak_viewers) {
    await query('UPDATE live_streams SET peak_viewers = $2 WHERE id = $1', [streamId, count]);
    row.peak_viewers = count;
  }
  return { stream: await toStreamView(row) };
};

export const leave = (profileId, streamId) => {
  viewers.get(streamId)?.delete(profileId);
};

/** Полный оффлайн зрителя — убрать сразу из всех эфиров, которые он
 *  смотрел, а не только из того, что было в последнем сообщении. */
export const leaveAllStreams = (profileId) => {
  const left = [];
  for (const [streamId, map] of viewers) {
    if (map.has(profileId)) { map.delete(profileId); left.push(streamId); }
  }
  return left;
};

const nameOf = async (profileId) => {
  const { rows } = await query('SELECT name FROM profiles WHERE id = $1', [profileId]);
  return rows[0]?.name ?? 'Пользователь';
};

export const sendChat = async (streamId, fromId, text) => {
  const clean = String(text ?? '').trim().slice(0, 300);
  if (!clean) return { error: 'empty' };
  const log = chatLog.get(streamId);
  if (!log) return { error: 'not_found' };
  const msg = { id: generateId(), userId: fromId, userName: await nameOf(fromId), text: clean, createdAt: Date.now() };
  log.push(msg);
  if (log.length > MAX_CHAT) log.shift();
  return { msg };
};

/** Системное сообщение чата (донат) — тем же журналом, чтобы попадало
 *  в ту же ленту без отдельного канала на клиенте. */
export const pushDonationChat = (streamId, fromId, fromName, amount, message) => {
  const log = chatLog.get(streamId);
  if (!log) return null;
  const msg = {
    id: generateId(), userId: fromId, userName: fromName,
    text: message ? String(message).slice(0, 200) : '', createdAt: Date.now(),
    isDonation: true, donationAmount: amount,
  };
  log.push(msg);
  if (log.length > MAX_CHAT) log.shift();
  return msg;
};

export const react = (streamId, emoji) => {
  if (!REACTIONS.includes(emoji)) return { error: 'bad_emoji' };
  const map = reactions.get(streamId);
  if (!map) return { error: 'not_found' };
  map[emoji] = (map[emoji] ?? 0) + 1;
  return { emoji, count: map[emoji] };
};

/** Прогноз может завести/закрыть только автор эфира — сверяем с
 *  настоящим author_id из базы, а не с тем, что прислал клиент. */
const requireAuthor = async (authorId, streamId) => {
  const row = await getRawStream(streamId);
  if (!row || row.ended_at) return { error: 'not_found' };
  if (row.author_id !== authorId) return { error: 'not_allowed' };
  return { row };
};

export const createPrediction = async (authorId, streamId, question, options) => {
  const check = await requireAuthor(authorId, streamId);
  if (check.error) return check;
  const list = predictions.get(streamId);
  if (!list) return { error: 'not_found' };
  const q = String(question ?? '').trim().slice(0, 140);
  const opts = Array.isArray(options) ? options.map((o) => String(o).trim().slice(0, 40)).filter(Boolean) : [];
  if (q.length < 3 || opts.length < 2 || opts.length > 5) return { error: 'bad_input' };
  const prediction = { id: generateId(), question: q, options: opts, votes: {}, closed: false, createdAt: Date.now() };
  list.push(prediction);
  return { prediction };
};

export const voteOnPrediction = (streamId, predictionId, profileId, optIdx) => {
  const list = predictions.get(streamId);
  const p = list?.find((x) => x.id === predictionId);
  if (!p) return { error: 'not_found' };
  if (p.closed) return { error: 'closed' };
  if (!Number.isInteger(optIdx) || optIdx < 0 || optIdx >= p.options.length) return { error: 'bad_option' };
  if (p.votes[profileId] !== undefined) return { error: 'already_voted' };
  p.votes[profileId] = optIdx;
  return { prediction: p };
};

export const closePrediction = async (authorId, streamId, predictionId) => {
  const check = await requireAuthor(authorId, streamId);
  if (check.error) return check;
  const list = predictions.get(streamId);
  const p = list?.find((x) => x.id === predictionId);
  if (!p) return { error: 'not_found' };
  p.closed = true;
  return { prediction: p };
};

/**
 * Донат — настоящий SkyCoin (баллы кошелька), списанный у зрителя и
 * зачисленный автору эфира. idempotencyKey защищает от двойной отправки
 * того же запроса (двойной клик/повтор сети): второй вызов с тем же
 * ключом отдаёт уже случившийся результат, а не списывает повторно.
 */
export const donate = async (fromId, streamId, amount, message, idempotencyKey) => {
  const amt = Math.trunc(Number(amount));
  if (!Number.isSafeInteger(amt) || amt <= 0 || amt > 1_000_000) return { error: 'bad_amount' };
  const key = String(idempotencyKey ?? '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) return { error: 'bad_idempotency_key' };

  // Быстрый путь: тот же ключ уже обработан раньше (обычный повтор
  // запроса, не гонка) — вернуть готовый результат, вообще не трогая
  // кошелёк повторно. Уникальный индекс ниже страхует только от
  // одновременной гонки тем же ключом, не от последовательного повтора.
  const { rows: already } = await query('SELECT id FROM live_stream_donations WHERE idempotency_key = $1', [key]);
  if (already[0]) return { ok: true, donationId: already[0].id, replay: true };

  const row = await getRawStream(streamId);
  if (!row || row.ended_at) return { error: 'not_found' };
  if (row.author_id === fromId) return { error: 'self_donate' };

  const spend = await wallet.spendPoints(fromId, amt, `Донат в трансляции «${row.title}»`, streamId);
  if (spend.error) return spend;

  const donationId = `livd-${generateId()}`;
  try {
    await query(
      `INSERT INTO live_stream_donations (id, stream_id, from_id, to_id, amount, message, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [donationId, streamId, fromId, row.author_id, amt, String(message ?? '').slice(0, 200), key],
    );
  } catch (err) {
    if (err.code !== '23505') throw err;
    // Тот же idempotency_key уже был обработан (повтор запроса) — вернуть
    // деньги за эту, вторую, попытку и не начислять автору дважды.
    await wallet.creditPoints(fromId, amt, 'points_refund', 'Возврат: повтор доната', streamId);
    const { rows: existing } = await query('SELECT id FROM live_stream_donations WHERE idempotency_key = $1', [key]);
    return { ok: true, donationId: existing[0]?.id, replay: true };
  }

  const fromName = await nameOf(fromId);
  await wallet.creditPoints(row.author_id, amt, 'stream_donation', `Донат от ${fromName}`, streamId);
  await query('UPDATE live_streams SET total_donations_points = total_donations_points + $2 WHERE id = $1', [streamId, amt]);

  const chatMsg = pushDonationChat(streamId, fromId, fromName, amt, message);
  // Динамический import — иначе цикл: signal.mjs статически тянет
  // join/leave/chat и т.п. отсюда для live:* обработчиков, а этому файлу
  // signal.mjs нужен только здесь и только для одного уведомления.
  const { pushLive } = await import('./signal.mjs');
  const audience = [...new Set([...viewerIds(streamId), row.author_id])];
  pushLive(audience, { type: 'live:donation', payload: { streamId, message: chatMsg, totalDonationsPoints: Number(row.total_donations_points) + amt } });
  return { ok: true, donationId, chatMsg };
};
