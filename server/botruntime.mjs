/**
 * Привязка внешнего сервера и учётные данные его программы.
 *
 * Код бота работает НЕ здесь. Владелец поднимает у себя небольшую
 * программу (Sky Bot SDK), и она подключается к Sky. Этот файл про то,
 * как Sky узнаёт её и почему верит именно ей.
 *
 * ── Почему не по адресу ────────────────────────────────────────────
 * Схема «bot_id + IP = доверенный сервер» не работает ни в одну
 * сторону. Адрес меняется сам: переезд, перезапуск в облаке, другой
 * провайдер, мобильный интернет. И совпавший адрес ничего не
 * доказывает — за одним адресом сидит сколько угодно чужих машин, а
 * подделать адрес отправителя в UDP тривиально. Поэтому у программы
 * собственный секрет, выданный один раз при привязке.
 *
 * ── Как происходит привязка ────────────────────────────────────────
 *   1. Владелец в «Моих ботах» нажимает «Подключить сервер».
 *   2. Sky выдаёт короткий код. Он одноразовый, живёт 10 минут и
 *      привязан к одному конкретному боту. В базе лежит хешем.
 *   3. Владелец запускает у себя программу и вводит код.
 *   4. Программа обменивает код на пару (runtime_id, runtime_secret).
 *      Код в ту же секунду становится недействительным.
 *   5. Секрет больше никогда не показывается — ни программе повторно,
 *      ни владельцу в браузере. Потерян — перепривязать.
 *
 * ── Как программа работает дальше ──────────────────────────────────
 * По паре она получает короткоживущий токен доступа (час) и ходит с
 * ним в Bot API. Долгоживущий секрет в каждом запросе не летает:
 * перехваченный токен протухнет сам, а секрет — нет.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { generateId, signToken, verifyToken, hashPassword, verifyPassword } from './security.mjs';
import { logBot, ownsBot, RT_ID_RE } from './bots.mjs';

/** Сколько живёт код привязки. Больше не нужно: его вводят сразу. */
const PAIRING_TTL_SEC = 10 * 60;
/** Сколько живёт токен доступа программы. */
const RUNTIME_TOKEN_TTL_SEC = 60 * 60;
/** Сколько кодов привязки можно выпустить на бота за час. */
export const PAIRING_PER_HOUR = 10;

/* ─── Код привязки ─────────────────────────────────────────────────── */

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Код вида SKY-XXXX-XXXX.
 *
 * Алфавит без 0/O и 1/I/L: код диктуют голосом и набирают руками, и
 * «ноль или О» — самая частая ошибка. 8 знаков из 32 — это 40 бит, а
 * живёт код десять минут и подбирается через ограничитель обращений.
 */
const newPairingCode = () => {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
  return `SKY-${out.slice(0, 4)}-${out.slice(4)}`;
};

const normalizeCode = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Хеш кода привязки.
 *
 * Не scrypt: код проверяется поиском по первичному ключу, а у scrypt
 * соль своя на каждую запись — искать пришлось бы перебором всей
 * таблицы. HMAC на серверном секрете даёт детерминированный ключ и при
 * этом не позволяет подобрать код по утёкшему дампу, не зная секрета.
 */
const hashPairingCode = (code) =>
  crypto.createHmac('sha256', config.jwtSecret)
    .update(`sky:bot-pairing:v1:${normalizeCode(code)}`)
    .digest('base64url');

/**
 * Выпускает код привязки.
 *
 * Прежние неиспользованные коды этого бота гасим: иначе у бота
 * накапливались бы живые коды, и каждый оставался лазейкой.
 */
export const createPairing = async (botId, ownerId) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };

  await query(
    "UPDATE bot_pairings SET expires_at = now() WHERE bot_id = $1 AND used_at IS NULL AND expires_at > now()",
    [botId],
  );

  const code = newPairingCode();
  await query(
    `INSERT INTO bot_pairings (code_hash, bot_id, owner_id, expires_at)
     VALUES ($1,$2,$3, now() + ($4 || ' seconds')::interval)`,
    [hashPairingCode(code), botId, ownerId, String(PAIRING_TTL_SEC)],
  );
  /* В журнал пишем факт, а не код. */
  await logBot(botId, 'info', 'pairing.issued', 'выпущен код привязки сервера');
  return { code, expiresIn: PAIRING_TTL_SEC };
};

/**
 * Обменивает код на учётные данные программы.
 *
 * Отметка «использован» ставится тем же UPDATE, что и находит код: два
 * одновременных обмена не смогут оба пройти проверку. Повторный обмен
 * того же кода отбивается здесь, а не в маршруте.
 *
 * Бот подставить нельзя: bot_id берётся из строки кода, а не из тела
 * запроса. Даже если программа пришлёт чужой идентификатор, он никуда
 * не попадёт — его здесь просто не читают.
 */
export const redeemPairing = async (rawCode, meta = {}) => {
  const code = normalizeCode(rawCode);
  if (code.length < 8 || code.length > 24) return { error: 'invalid_code' };

  const { rows } = await query(
    `UPDATE bot_pairings SET used_at = now()
      WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING bot_id, owner_id`,
    [hashPairingCode(code)],
  );
  if (!rows[0]) return { error: 'invalid_code' };
  const { bot_id: botId } = rows[0];

  /* Один живой runtime на бота. Новая привязка вытесняет старую, и её
     секрет перестаёт подходить немедленно — это и есть «перепривязать
     сервер». */
  const { rows: old } = await query(
    "UPDATE bot_runtimes SET revoked_at = now() WHERE bot_id = $1 AND revoked_at IS NULL RETURNING id",
    [botId],
  );

  const runtimeId = `brt-${generateId()}`;
  /* 256 бит случайности. Секрет уходит программе один раз и в базе
     остаётся только хешем — украденный дамп не даёт подключиться. */
  const secret = crypto.randomBytes(32).toString('base64url');
  const secretHash = await hashPassword(secret);

  const delivery = meta.delivery === 'webhook' ? 'webhook' : 'poll';
  let webhookUrl = null;
  let webhookSecret = null;
  if (delivery === 'webhook') {
    const checked = checkWebhookUrl(meta.webhookUrl);
    if (checked.error) return { error: checked.error };
    webhookUrl = checked.url;
    webhookSecret = crypto.randomBytes(32).toString('base64url');
  }

  await query(
    `INSERT INTO bot_runtimes (id, bot_id, secret_hash, delivery, webhook_url, webhook_secret,
                               label, runtime_version, sdk, connected_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now())`,
    [runtimeId, botId, secretHash, delivery, webhookUrl, webhookSecret,
     String(meta.label ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64),
     String(meta.version ?? '').slice(0, 32) || null,
     String(meta.sdk ?? '').slice(0, 32) || null],
  );
  await query('UPDATE bot_pairings SET runtime_id = $2 WHERE code_hash = $1',
    [hashPairingCode(code), runtimeId]);

  await logBot(botId, 'info', 'runtime.linked',
    old.length ? 'сервер перепривязан, прежние учётные данные отозваны' : 'сервер привязан');

  /* Единственный раз, когда секрет существует за пределами хеша. */
  return {
    botId,
    runtimeId,
    runtimeSecret: secret,
    webhookSecret,
    delivery,
    tokenTtl: RUNTIME_TOKEN_TTL_SEC,
  };
};

/* ─── Токен доступа программы ──────────────────────────────────────── */

/**
 * Меняет пару (runtime_id, secret) на короткоживущий токен.
 *
 * Ответ одинаков для «нет такого runtime», «отозван» и «не тот
 * секрет»: иначе по коду ответа можно было бы перебирать существующие
 * идентификаторы.
 */
export const runtimeSession = async (runtimeId, secret) => {
  if (!RT_ID_RE.test(String(runtimeId ?? ''))) return { error: 'invalid_credentials' };

  const { rows } = await query(
    `SELECT r.id, r.bot_id, r.secret_hash, r.revoked_at, b.id AS bot_exists
       FROM bot_runtimes r JOIN bots b ON b.id = r.bot_id
      WHERE r.id = $1`,
    [runtimeId],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return { error: 'invalid_credentials' };
  if (!(await verifyPassword(String(secret ?? ''), row.secret_hash))) {
    await logBot(row.bot_id, 'warn', 'runtime.auth_failed', 'неверные учётные данные сервера');
    return { error: 'invalid_credentials' };
  }

  await query(
    'UPDATE bot_runtimes SET connected_at = now(), last_seen_at = now() WHERE id = $1',
    [runtimeId],
  );

  /* В токене — только идентификаторы. Секрета в нём нет, поэтому
     перехваченный токен нельзя превратить в постоянный доступ. */
  const token = signToken(
    { typ: 'bot', rt: runtimeId, bot: row.bot_id },
    config.jwtSecret, RUNTIME_TOKEN_TTL_SEC,
  );
  return { token, expiresIn: RUNTIME_TOKEN_TTL_SEC, botId: row.bot_id };
};

/**
 * Разбирает токен программы и сверяет его с живой записью.
 *
 * Подписи мало: после «Отвязать сервер» токен формально действителен до
 * конца своего часа. Поэтому каждый запрос сверяется с базой — отозванный
 * runtime перестаёт работать в ту же секунду.
 *
 * Возвращает { runtimeId, botId } либо null. bot_id берётся отсюда и
 * нигде больше: что бы программа ни прислала в теле запроса, работать
 * она будет только со своим ботом.
 */
export const readRuntime = async (token) => {
  const payload = verifyToken(String(token ?? ''), config.jwtSecret);
  if (!payload || payload.typ !== 'bot' || !payload.rt || !payload.bot) return null;

  const { rows } = await query(
    'SELECT bot_id, revoked_at, delivery FROM bot_runtimes WHERE id = $1',
    [payload.rt],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;
  /* Токен, выписанный на другого бота, не подойдёт даже с живым
     runtime: сверяем пару, а не каждое поле по отдельности. */
  if (row.bot_id !== payload.bot) return null;

  return { runtimeId: payload.rt, botId: row.bot_id, delivery: row.delivery };
};

/* ─── Живость ──────────────────────────────────────────────────────── */

/**
 * Отметка «программа на связи».
 *
 * Ставится при каждом обращении к Bot API, а не отдельным запросом:
 * так «онлайн» означает «действительно работает», а не «кто-то раз в
 * минуту шлёт пустой пинг».
 */
export const touchRuntime = async (runtimeId, patch = {}) => {
  const sets = ['last_seen_at = now()'];
  const args = [runtimeId];
  if (patch.version) { args.push(String(patch.version).slice(0, 32)); sets.push(`runtime_version = $${args.length}`); }
  if (patch.sdk)     { args.push(String(patch.sdk).slice(0, 32));     sets.push(`sdk = $${args.length}`); }
  if (patch.events)  { args.push(Number(patch.events) || 0);          sets.push(`events_sent = events_sent + $${args.length}`); }
  if (patch.actions) { args.push(Number(patch.actions) || 0);         sets.push(`actions_done = actions_done + $${args.length}`); }
  await query(`UPDATE bot_runtimes SET ${sets.join(', ')} WHERE id = $1`, args);
};

/** Программа сама сообщила о своей ошибке — показываем её владельцу. */
export const reportRuntimeError = async (runtimeId, botId, message) => {
  const clean = String(message ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  await query(
    'UPDATE bot_runtimes SET last_error = $2, last_error_at = now(), last_seen_at = now() WHERE id = $1',
    [runtimeId, clean || 'ошибка без описания'],
  );
  await logBot(botId, 'error', 'runtime.error', clean);
};

/** Сбросить отметку об ошибке — после удачного цикла. */
export const clearRuntimeError = async (runtimeId) => {
  await query('UPDATE bot_runtimes SET last_error = NULL, last_error_at = NULL WHERE id = $1', [runtimeId]);
};

/* ─── Отвязка ──────────────────────────────────────────────────────── */

/**
 * «Отвязать сервер».
 *
 * Отметка revoked_at — не пометка «скрыть»: readRuntime смотрит на неё
 * при каждом запросе, поэтому выданный час назад токен перестаёт
 * работать сразу, а не когда истечёт.
 */
export const unlinkRuntime = async (botId, ownerId) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };
  const { rowCount } = await query(
    'UPDATE bot_runtimes SET revoked_at = now() WHERE bot_id = $1 AND revoked_at IS NULL',
    [botId],
  );
  if (!rowCount) return { error: 'not_linked' };

  /* Неотданные события удерживать незачем: их некому забирать, а новая
     программа не должна получить пачку чужой истории при первом же
     подключении. */
  await query('DELETE FROM bot_events WHERE bot_id = $1 AND acked_at IS NULL', [botId]);
  /* Опубликованный бот без сервера — карточка, которая не отвечает. */
  await query("UPDATE bots SET status = 'private' WHERE id = $1 AND status IN ('published','pending')", [botId]);
  await logBot(botId, 'warn', 'runtime.unlinked', 'сервер отвязан владельцем, учётные данные отозваны');
  return { ok: true };
};

/* ─── Адрес вебхука ────────────────────────────────────────────────── */

/**
 * Проверка адреса, куда Sky будет стучаться сам.
 *
 * Адрес присылает пользователь, а запрос по нему делает сервер Sky —
 * это ровно тот случай, когда чужой ввод превращается в исходящее
 * соединение изнутри сети. Поэтому: только https, только имя (не
 * литеральный адрес), и никаких внутренних имён. Сам адрес ещё раз
 * проверяется при доставке, уже после разрешения имени, — см.
 * botwebhook.mjs: имя может указывать на внутренний адрес, и узнать
 * это можно только разрешив его.
 */
export const checkWebhookUrl = (raw) => {
  let url;
  try { url = new URL(String(raw ?? '')); } catch { return { error: 'invalid_webhook_url' }; }

  if (url.protocol !== 'https:') return { error: 'webhook_must_be_https' };
  if (url.username || url.password) return { error: 'invalid_webhook_url' };
  if (url.port && !['443', '8443'].includes(url.port)) return { error: 'invalid_webhook_port' };

  const host = url.hostname.toLowerCase();
  /* Литеральный адрес запрещён целиком: у него нет имени, которое
     можно проверить, а IPv6 в скобках легко прячет ::1 и fd00::/8. */
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return { error: 'webhook_host_not_allowed' };
  if (host === 'localhost' || host.endsWith('.localhost')
      || host.endsWith('.local') || host.endsWith('.internal')
      || host.endsWith('.home.arpa') || !host.includes('.')) {
    return { error: 'webhook_host_not_allowed' };
  }

  url.hash = '';
  return { url: url.toString() };
};

/** Настройка доставки — только владельцем и только для своего бота. */
export const setDelivery = async (botId, ownerId, mode, webhookUrl) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };

  const { rows } = await query(
    'SELECT id FROM bot_runtimes WHERE bot_id = $1 AND revoked_at IS NULL', [botId],
  );
  if (!rows[0]) return { error: 'not_linked' };

  if (mode === 'poll') {
    await query(
      "UPDATE bot_runtimes SET delivery = 'poll', webhook_url = NULL, webhook_secret = NULL WHERE id = $1",
      [rows[0].id],
    );
    await logBot(botId, 'info', 'delivery.poll', 'события забирает сам сервер владельца');
    return { delivery: 'poll' };
  }

  const checked = checkWebhookUrl(webhookUrl);
  if (checked.error) return { error: checked.error };
  const secret = crypto.randomBytes(32).toString('base64url');
  await query(
    "UPDATE bot_runtimes SET delivery = 'webhook', webhook_url = $2, webhook_secret = $3 WHERE id = $1",
    [rows[0].id, checked.url, secret],
  );
  /* Адрес в журнал пишем без строки запроса: в ней бывает ключ. */
  await logBot(botId, 'info', 'delivery.webhook', `вебхук на ${new URL(checked.url).origin}`);
  /* Ключ подписи возвращается один раз — тому, кто его заказал. */
  return { delivery: 'webhook', url: checked.url, webhookSecret: secret };
};

/** Данные для доставки вебхука. Только для внутреннего вызова. */
export const webhookTarget = async (botId) => {
  const { rows } = await query(
    `SELECT id, webhook_url, webhook_secret FROM bot_runtimes
      WHERE bot_id = $1 AND revoked_at IS NULL AND delivery = 'webhook'
        AND webhook_url IS NOT NULL`,
    [botId],
  );
  return rows[0] ? { runtimeId: rows[0].id, url: rows[0].webhook_url, secret: rows[0].webhook_secret } : null;
};
