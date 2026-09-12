/**
 * Sky Bots: данные и права.
 *
 * Здесь живут все решения «кому что можно». Маршруты (routes/bots.mjs)
 * только принимают запрос и зовут отсюда — иначе проверку пришлось бы
 * повторять в каждой ветке, и однажды в одной из них её бы не оказалось.
 *
 * Главное, чего здесь НЕТ: выполнения кода бота. Sky не запускает
 * bot.js, не поднимает контейнер и не держит процесс. Поле `code` —
 * черновик, который владелец копирует к себе на сервер. Процессор и
 * память под бота тратит его сервер, а Sky складывает события и
 * принимает действия.
 *
 * Бот пишет в чаты через обычный профиль, помеченный is_bot. Так все
 * проверки мессенджера — участие в чате, блокировки, правила группы —
 * работают для бота сами собой, а не второй, отдельной веткой кода.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';

/* ─── Формы идентификаторов ─────────────────────────────────────────────
   Идентификатор приходит от клиента, а значит может быть любым. Форму
   проверяем до запроса: иначе в базу уезжает мусор, а по сообщениям об
   ошибке можно выяснять, что в ней есть. */
export const BOT_ID_RE = /^bot-[0-9a-f-]{36}$/;
export const RT_ID_RE  = /^brt-[0-9a-f-]{36}$/;
export const PENDING_ID_RE = /^bip-[0-9a-f-]{36}$/;

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
/** Ник бота обязан кончаться на bot — чтобы его нельзя было спутать с человеком. */
const BOT_SUFFIX_RE = /bot$/i;

const MAX_NAME = 64;
const MAX_SHORT = 120;
const MAX_DESC = 2000;
/** Черновик кода. Это не программа, а текст: читать его будет человек. */
const MAX_CODE = 256 * 1024;
const MAX_COMMANDS = 32;
const MAX_BOTS_PER_OWNER = 20;

const CATEGORIES = ['Утилиты', 'Новости', 'ИИ', 'Маркет', 'Игры', 'Развлечения', 'Другое'];
const ICONS = ['bot', 'zap', 'sparkles', 'cloud', 'newspaper', 'calculator',
               'cart', 'shield', 'rocket', 'brain', 'globe', 'gamepad'];

/**
 * Чистка строки от управляющих символов.
 *
 * Перевод каретки и забой в имени бота — это не имя, а способ подделать
 * вид списка у того, кто его читает.
 */
const text = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);

const accent = (value, fallback = '#4e8cf7') =>
  (/^#[0-9a-fA-F]{6}$/.test(String(value ?? '')) ? String(value) : fallback);

/* ─── Журнал ────────────────────────────────────────────────────────────
   То, что владелец видит на вкладке «Логи». Секретов здесь нет: ни
   токена, ни кода привязки, ни ключа вебхука сюда не попадает — см.
   safeDetail. Журнал читает владелец, но утёкший дамп базы не должен
   выдавать учётные данные. */

/**
 * Отрезает из строки всё, что похоже на секрет.
 *
 * Два правила. Первое убирает длинные бессмысленные строки — так
 * выглядят токены и ключи. Второе срабатывает на явную подпись
 * («token=…»), даже если само значение короткое.
 */
const safeDetail = (value) => text(value, 500)
  .replace(/(secret|token|code|key|pass\w*)(\s*[=:]\s*)\S+/gi, (_m, word, sep) => `${word}${sep}…`)
  .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '…');

export const logBot = async (botId, level, event, detail = '') => {
  try {
    await query(
      'INSERT INTO bot_log (bot_id, level, event, detail) VALUES ($1,$2,$3,$4)',
      [botId, oneOf(level, ['info', 'warn', 'error'], 'info'), text(event, 64), safeDetail(detail)],
    );
  } catch {
    /* Журнал не должен ронять операцию, которую он описывает. */
  }
};

export const listLog = async (botId, ownerId, limit = 100) => {
  if (!(await ownsBot(botId, ownerId))) return null;
  const { rows } = await query(
    `SELECT id, level, event, detail, created_at FROM bot_log
      WHERE bot_id = $1 ORDER BY id DESC LIMIT $2`,
    [botId, Math.min(Math.max(Number(limit) || 100, 1), 300)],
  );
  return rows.map((r) => ({
    id: String(r.id), level: r.level, event: r.event,
    detail: r.detail, at: r.created_at.toISOString(),
  }));
};

/* ─── Право владения ────────────────────────────────────────────────── */

/**
 * Это мой бот?
 *
 * Единственная функция, дающая право на управление. Всё, что меняет
 * бота, обязано пройти через неё, и ни одна ручка не решает сама.
 */
export const ownsBot = async (botId, ownerId) => {
  if (!BOT_ID_RE.test(String(botId ?? '')) || !ownerId) return false;
  const { rowCount } = await query(
    'SELECT 1 FROM bots WHERE id = $1 AND owner_id = $2', [botId, ownerId],
  );
  return rowCount > 0;
};

/** Профиль, от чьего имени бот пишет. null, если бота нет. */
export const botProfileId = async (botId) => {
  const { rows } = await query('SELECT profile_id FROM bots WHERE id = $1', [botId]);
  return rows[0]?.profile_id ?? null;
};

/* ─── Вид бота наружу ──────────────────────────────────────────────────
   Две разные проекции, и это не украшение. Публичная не содержит ни
   кода, ни идентификатора профиля, ни чего-либо про сервер владельца:
   «Все боты» открыты каждому, и через них не должно быть видно ни
   учётных данных, ни внутренних идентификаторов. */

const publicView = (row) => ({
  id: row.id,
  name: row.name,
  username: `@${row.username}`,
  shortDesc: row.short_desc,
  desc: row.description,
  category: row.category,
  icon: row.icon,
  accent: row.accent,
  verified: row.verified,
  inline: row.inline_enabled,
  inlineTrigger: row.inline_enabled ? row.inline_trigger : undefined,
  inlinePlaceholder: row.inline_enabled ? row.inline_placeholder : undefined,
  users: Number(row.users_count ?? 0),
  /* Онлайн ли бот — это про то, поднят ли сервер владельца. Показывать
     можно: без этого человек пишет в пустоту и ждёт ответа, которого не
     будет. А вот КАКОЙ это сервер — не показываем никогда. */
  online: row.online === true,
  commands: row.commands ?? [],
});

const ownerView = (row) => ({
  ...publicView(row),
  status: row.status,
  rejectReason: row.reject_reason ?? undefined,
  codeLang: row.code_lang,
  hasCode: Boolean(row.code),
  createdAt: row.created_at?.toISOString?.(),
  own: true,
});

/** Команды одним запросом на список ботов, а не по одному на карточку. */
const commandsFor = async (botIds) => {
  if (botIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT bot_id, cmd, description FROM bot_commands
      WHERE bot_id = ANY($1::text[]) ORDER BY bot_id, ordering, cmd`,
    [botIds],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.bot_id)) map.set(r.bot_id, []);
    map.get(r.bot_id).push({ cmd: r.cmd, desc: r.description });
  }
  return map;
};

/* ─── Каталог ──────────────────────────────────────────────────────── */

export const listCategories = () => CATEGORIES.slice();

/**
 * «Все боты»: только опубликованные.
 *
 * Черновик чужого бота сюда не попадает ни при каком запросе — условие
 * стоит в самом запросе, а не в разборе результата.
 */
export const listPublished = async ({ q = '', category = '' } = {}) => {
  const clauses = ["b.status = 'published'"];
  const args = [];

  const search = text(q, 64).toLowerCase();
  if (search.length >= 2) {
    args.push(`%${search.replace(/([\\%_])/g, '\\$1')}%`);
    clauses.push(`(lower(b.name) LIKE $${args.length} OR lower(b.username) LIKE $${args.length}
                   OR lower(b.short_desc) LIKE $${args.length})`);
  }
  if (CATEGORIES.includes(category)) {
    args.push(category);
    clauses.push(`b.category = $${args.length}`);
  }

  const { rows } = await query(
    `SELECT b.*,
            (SELECT count(*) FROM bot_users u WHERE u.bot_id = b.id) AS users_count,
            EXISTS (SELECT 1 FROM bot_runtimes r
                     WHERE r.bot_id = b.id AND r.revoked_at IS NULL
                       AND r.last_seen_at > now() - interval '90 seconds') AS online
       FROM bots b
      WHERE ${clauses.join(' AND ')}
      ORDER BY b.verified DESC, users_count DESC, b.name
      LIMIT 100`,
    args,
  );
  const cmds = await commandsFor(rows.map((r) => r.id));
  return rows.map((r) => publicView({ ...r, commands: cmds.get(r.id) ?? [] }));
};

/** Один бот для карточки. Черновик виден только владельцу. */
export const readBot = async (botId, viewerId) => {
  if (!BOT_ID_RE.test(String(botId ?? ''))) return null;
  const { rows } = await query(
    `SELECT b.*,
            (SELECT count(*) FROM bot_users u WHERE u.bot_id = b.id) AS users_count,
            EXISTS (SELECT 1 FROM bot_runtimes r
                     WHERE r.bot_id = b.id AND r.revoked_at IS NULL
                       AND r.last_seen_at > now() - interval '90 seconds') AS online
       FROM bots b WHERE b.id = $1`,
    [botId],
  );
  const row = rows[0];
  if (!row) return null;
  const own = row.owner_id === viewerId;
  if (!own && row.status !== 'published') return null;

  const cmds = (await commandsFor([botId])).get(botId) ?? [];
  return own ? ownerView({ ...row, commands: cmds }) : publicView({ ...row, commands: cmds });
};

/** Поиск бота по нику — для inline и для ссылок вида @skyweather. */
export const readBotByUsername = async (username, viewerId) => {
  const uname = String(username ?? '').replace(/^@/, '').toLowerCase();
  if (!USERNAME_RE.test(uname)) return null;
  const { rows } = await query('SELECT id FROM bots WHERE lower(username) = $1', [uname]);
  return rows[0] ? readBot(rows[0].id, viewerId) : null;
};

/* ─── «Мои боты» ───────────────────────────────────────────────────── */

/**
 * Список владельца вместе с состоянием его сервера.
 *
 * Статус считается из времени последнего обращения runtime, а не из
 * поля «активен», которое кто-то выставил руками. Раньше «Онлайн»
 * означало ровно «в localStorage лежит true».
 */
export const listMine = async (ownerId) => {
  const { rows } = await query(
    `SELECT b.*,
            (SELECT count(*) FROM bot_users u WHERE u.bot_id = b.id) AS users_count,
            r.id                AS rt_id,
            r.delivery          AS rt_delivery,
            r.label             AS rt_label,
            r.runtime_version   AS rt_version,
            r.sdk               AS rt_sdk,
            r.connected_at      AS rt_connected,
            r.last_seen_at      AS rt_seen,
            r.last_error        AS rt_error,
            r.last_error_at     AS rt_error_at,
            r.events_sent       AS rt_events,
            r.actions_done      AS rt_actions,
            (SELECT count(*) FROM bot_events e
              WHERE e.bot_id = b.id AND e.acked_at IS NULL) AS queued
       FROM bots b
       LEFT JOIN bot_runtimes r
              ON r.bot_id = b.id AND r.revoked_at IS NULL
      WHERE b.owner_id = $1
      ORDER BY b.created_at DESC`,
    [ownerId],
  );
  const cmds = await commandsFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...ownerView({ ...r, commands: cmds.get(r.id) ?? [], online: runtimeState(r).status === 'online' }),
    runtime: runtimeState(r),
    queued: Number(r.queued ?? 0),
  }));
};

/**
 * Состояние сервера владельца.
 *
 * Четыре случая, и все различимы снаружи:
 *   unlinked    — сервер не привязан вовсе;
 *   online      — обращался только что;
 *   connecting  — привязан и был на связи, но последнее обращение
 *                 свежее срока ожидания: обрыв, а не выключение;
 *   error       — последняя попытка кончилась ошибкой;
 *   offline     — молчит.
 *
 * «Онлайн» не показывается, если сервер владельца на самом деле не
 * подключён: это первое, что человек читает, и обманывать здесь
 * нельзя.
 */
const ONLINE_SEC = 90;
const CONNECTING_SEC = 300;

const runtimeState = (r) => {
  if (!r.rt_id) return { linked: false, status: 'unlinked' };

  const seen = r.rt_seen ? new Date(r.rt_seen).getTime() : 0;
  const age = seen ? (Date.now() - seen) / 1000 : Infinity;
  const errAt = r.rt_error_at ? new Date(r.rt_error_at).getTime() : 0;
  /* Ошибка перекрывает «офлайн» только пока она свежая и свежее
     последнего удачного обращения: иначе бот навсегда оставался бы
     «с ошибкой» из-за одной старой записи. */
  const errFresh = errAt && Date.now() - errAt < CONNECTING_SEC * 1000 && errAt >= seen;

  const status = age <= ONLINE_SEC ? 'online'
    : errFresh ? 'error'
      : age <= CONNECTING_SEC ? 'connecting'
        : 'offline';

  return {
    linked: true,
    status,
    /* Идентификатор runtime — внутренний. Наружу не отдаём: он часть
       учётных данных пары «кто подключается». */
    label: r.rt_label || '',
    delivery: r.rt_delivery,
    version: r.rt_version ?? null,
    sdk: r.rt_sdk ?? null,
    connectedAt: r.rt_connected ? new Date(r.rt_connected).toISOString() : null,
    lastSeen: r.rt_seen ? new Date(r.rt_seen).toISOString() : null,
    lastError: r.rt_error ?? null,
    lastErrorAt: r.rt_error_at ? new Date(r.rt_error_at).toISOString() : null,
    eventsSent: Number(r.rt_events ?? 0),
    actionsDone: Number(r.rt_actions ?? 0),
  };
};

export { runtimeState };

/* ─── Создание и правка ────────────────────────────────────────────── */

/**
 * Заводит бота вместе с его профилем.
 *
 * Профиль и бот создаются одной транзакцией: бот без профиля не смог бы
 * ничего написать, а профиль без бота остался бы висеть в справочнике
 * людей как непонятно чей.
 */
export const createBot = async (ownerId, input = {}) => {
  const name = text(input.name, MAX_NAME);
  if (name.length < 2) return { error: 'invalid_name' };

  const uname = String(input.username ?? '').replace(/^@/, '').trim();
  if (!USERNAME_RE.test(uname)) return { error: 'invalid_username' };
  if (!BOT_SUFFIX_RE.test(uname)) return { error: 'username_must_end_with_bot' };

  const { rows: counted } = await query(
    'SELECT count(*)::int AS n FROM bots WHERE owner_id = $1', [ownerId],
  );
  if (counted[0].n >= MAX_BOTS_PER_OWNER) return { error: 'too_many' };

  const botId = `bot-${generateId()}`;
  const profileId = `acc-${generateId()}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* sky_id остаётся пустым: бот не принадлежит ничьей учётной записи
       как человек. Ограничитель «не больше двух профилей на Sky ID»
       такие строки не считает — он сравнивает sky_id, а NULL ничему не
       равен. */
    await client.query(
      `INSERT INTO profiles (id, sky_id, username, name, is_bot)
       VALUES ($1, NULL, $2, $3, TRUE)`,
      [profileId, uname, name],
    );
    await client.query(
      `INSERT INTO bots (id, owner_id, profile_id, name, username,
                         short_desc, description, category, icon, accent, code, code_lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [botId, ownerId, profileId, name, uname,
       text(input.shortDesc, MAX_SHORT), text(input.desc, MAX_DESC),
       oneOf(input.category, CATEGORIES, 'Другое'),
       oneOf(input.icon, ICONS, 'bot'), accent(input.accent),
       input.code ? encryptContent(text(input.code, MAX_CODE)) : null,
       oneOf(input.codeLang, ['js', 'ts', 'py', 'go', 'other'], 'js')],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return { error: 'username_taken' };
    throw err;
  } finally {
    client.release();
  }

  await logBot(botId, 'info', 'created', `бот «${name}» создан`);
  return { bot: await readBot(botId, ownerId) };
};

/**
 * Правит бота.
 *
 * Владелец не передаётся: его берут из сессии выше по стеку, а сюда
 * приходит уже проверенный. Ни owner_id, ни profile_id, ни id тут
 * поменять нельзя — этих полей нет среди правимых.
 */
export const updateBot = async (botId, ownerId, patch = {}) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };

  const sets = [];
  const args = [botId];
  const put = (column, value) => { args.push(value); sets.push(`${column} = $${args.length}`); };

  if (patch.name !== undefined) {
    const v = text(patch.name, MAX_NAME);
    if (v.length < 2) return { error: 'invalid_name' };
    put('name', v);
  }
  if (patch.shortDesc !== undefined) put('short_desc', text(patch.shortDesc, MAX_SHORT));
  if (patch.desc !== undefined)      put('description', text(patch.desc, MAX_DESC));
  if (patch.category !== undefined)  put('category', oneOf(patch.category, CATEGORIES, 'Другое'));
  if (patch.icon !== undefined)      put('icon', oneOf(patch.icon, ICONS, 'bot'));
  if (patch.accent !== undefined)    put('accent', accent(patch.accent));
  if (patch.codeLang !== undefined)  put('code_lang', oneOf(patch.codeLang, ['js', 'ts', 'py', 'go', 'other'], 'js'));

  if (patch.code !== undefined) {
    const raw = String(patch.code ?? '');
    if (raw.length > MAX_CODE) return { error: 'code_too_large' };
    /* Код хранится зашифрованным и НЕ ЗАПУСКАЕТСЯ. Это черновик для
       владельца, а не программа для Sky. */
    put('code', raw ? encryptContent(raw) : null);
  }

  if (patch.inline !== undefined) {
    const on = patch.inline === true;
    put('inline_enabled', on);
    if (on) {
      const trigger = String(patch.inlineTrigger ?? '').replace(/^#/, '').trim().toLowerCase();
      if (!/^[a-z0-9_а-яё]{2,24}$/i.test(trigger)) return { error: 'invalid_trigger' };
      /* Отказ до записи: так владелец видит «триггер занят», а не
         непонятную ошибку базы. Сама уникальность всё равно стоит в
         базе — проверка здесь только ради внятного ответа, и на неё
         одну полагаться нельзя: два одновременных запроса оба её
         пройдут. */
      const { rowCount: busy } = await query(
        `SELECT 1 FROM bots
          WHERE lower(inline_trigger) = $1 AND inline_enabled AND id <> $2`,
        [trigger, botId],
      );
      if (busy) return { error: 'trigger_taken' };
      put('inline_trigger', trigger);
      put('inline_placeholder', text(patch.inlinePlaceholder, MAX_SHORT));
    } else {
      put('inline_trigger', null);
    }
  }

  if (sets.length === 0) return { bot: await readBot(botId, ownerId) };
  sets.push('updated_at = now()');

  try {
    await query(`UPDATE bots SET ${sets.join(', ')} WHERE id = $1`, args);
  } catch (err) {
    if (err.code === '23505') return { error: 'trigger_taken' };
    throw err;
  }

  /* Имя бота видно собеседникам, поэтому меняем его и в профиле —
     иначе в чате осталось бы старое. */
  if (patch.name !== undefined) {
    await query(
      'UPDATE profiles SET name = $2, updated_at = now() WHERE id = (SELECT profile_id FROM bots WHERE id = $1)',
      [botId, text(patch.name, MAX_NAME)],
    );
  }
  return { bot: await readBot(botId, ownerId) };
};

/** Черновик кода — только владельцу и только по отдельному запросу. */
export const readCode = async (botId, ownerId) => {
  if (!(await ownsBot(botId, ownerId))) return null;
  const { rows } = await query('SELECT code, code_lang FROM bots WHERE id = $1', [botId]);
  if (!rows[0]) return null;
  return { code: rows[0].code ? decryptContent(rows[0].code) : '', lang: rows[0].code_lang };
};

/**
 * Удаляет бота.
 *
 * Профиль уходит следом: иначе он остался бы в справочнике и в чужих
 * чатах как собеседник, которому некому отвечать. Всё остальное —
 * runtime, события, журнал — падает по внешним ключам.
 */
export const deleteBot = async (botId, ownerId) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };
  const profileId = await botProfileId(botId);
  await query('DELETE FROM bots WHERE id = $1 AND owner_id = $2', [botId, ownerId]);
  if (profileId) await query('DELETE FROM profiles WHERE id = $1 AND is_bot', [profileId]);
  return { ok: true };
};

/* ─── Команды ──────────────────────────────────────────────────────── */

export const setCommands = async (botId, ownerId, list) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };
  if (!Array.isArray(list)) return { error: 'invalid_commands' };

  const clean = [];
  for (const raw of list.slice(0, MAX_COMMANDS)) {
    const cmd = text(raw?.cmd, 32).toLowerCase();
    if (!/^\/[a-z0-9_]{1,30}$/.test(cmd)) continue;
    if (clean.some((c) => c.cmd === cmd)) continue;
    clean.push({ cmd, desc: text(raw?.desc, 120) });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM bot_commands WHERE bot_id = $1', [botId]);
    for (let i = 0; i < clean.length; i += 1) {
      await client.query(
        'INSERT INTO bot_commands (bot_id, cmd, description, ordering) VALUES ($1,$2,$3,$4)',
        [botId, clean[i].cmd, clean[i].desc, i],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { commands: clean };
};

/* ─── Публикация ───────────────────────────────────────────────────── */

/**
 * Отправить бота в каталог.
 *
 * Условие «сервер должен быть привязан» не формальность: опубликованный
 * бот без сервера — это карточка, которая никогда не отвечает. Человек
 * пишет ей и ждёт.
 */
export const submitBot = async (botId, ownerId) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };
  const { rows } = await query(
    `SELECT b.status,
            EXISTS (SELECT 1 FROM bot_runtimes r
                     WHERE r.bot_id = b.id AND r.revoked_at IS NULL) AS linked
       FROM bots b WHERE b.id = $1`,
    [botId],
  );
  if (rows[0].status === 'pending')   return { error: 'already_pending' };
  if (rows[0].status === 'published') return { error: 'already_published' };
  if (!rows[0].linked)                return { error: 'runtime_required' };

  await query(
    "UPDATE bots SET status = 'pending', reject_reason = NULL, updated_at = now() WHERE id = $1",
    [botId],
  );
  await logBot(botId, 'info', 'submitted', 'отправлен на проверку');
  return { bot: await readBot(botId, ownerId) };
};

/** Снять с публикации — право владельца, без проверки модератором. */
export const unpublishBot = async (botId, ownerId) => {
  if (!(await ownsBot(botId, ownerId))) return { error: 'not_found' };
  await query("UPDATE bots SET status = 'private', updated_at = now() WHERE id = $1", [botId]);
  await logBot(botId, 'info', 'unpublished', 'снят с публикации владельцем');
  return { bot: await readBot(botId, ownerId) };
};

/** Очередь модерации. Право администратора проверяет вызывающий. */
export const moderationQueue = async () => {
  const { rows } = await query(
    `SELECT b.*, p.name AS owner_name,
            (SELECT count(*) FROM bot_users u WHERE u.bot_id = b.id) AS users_count
       FROM bots b LEFT JOIN profiles p ON p.id = b.owner_id
      WHERE b.status = 'pending' ORDER BY b.updated_at LIMIT 100`,
  );
  const cmds = await commandsFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...publicView({ ...r, commands: cmds.get(r.id) ?? [] }),
    ownerName: r.owner_name ?? '—',
    submittedAt: r.updated_at.toISOString(),
  }));
};

export const moderateBot = async (botId, approve, reason = '') => {
  if (!BOT_ID_RE.test(String(botId ?? ''))) return { error: 'not_found' };
  let rowCount;
  try {
    ({ rowCount } = await query(
      `UPDATE bots SET status = $2, reject_reason = $3, verified = verified OR $4, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [botId, approve ? 'published' : 'rejected', approve ? null : text(reason, 300), approve === true],
    ));
  } catch (err) {
    /* Ограничение базы — не повод отвечать «внутренняя ошибка»
       человеку, который нажал правильную кнопку. */
    if (err.code === '23505') return { error: 'trigger_taken' };
    throw err;
  }
  if (!rowCount) return { error: 'not_pending' };
  await logBot(botId, 'info', approve ? 'approved' : 'rejected',
    approve ? 'опубликован' : `отклонён: ${text(reason, 200)}`);
  return { ok: true };
};

/* ─── Кто пользуется ботом ─────────────────────────────────────────── */

export const markBotUser = async (botId, userId) => {
  await query(
    'INSERT INTO bot_users (bot_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [botId, userId],
  );
};

/* ─── Заготовки inline ─────────────────────────────────────────────── */

/** Сколько живёт предложенный ботом текст, пока человек решает. */
const INLINE_TTL_SEC = 120;

/**
 * Складывает предложение бота.
 *
 * Само по себе оно ничего не отправляет. Текст лежит зашифрованным и
 * ждёт, пока человек нажмёт «Отправить» в своём же сеансе.
 */
export const putInlinePending = async (botId, userId, chatId, items) => {
  const out = [];
  for (const item of (Array.isArray(items) ? items : []).slice(0, 8)) {
    const body = text(item?.text, 4000);
    if (!body) continue;
    const id = `bip-${generateId()}`;
    await query(
      `INSERT INTO bot_inline_pending (id, bot_id, user_id, chat_id, title, text, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' seconds')::interval)`,
      [id, botId, userId, chatId, text(item?.title, 120), encryptContent(body), String(INLINE_TTL_SEC)],
    );
    out.push({ id, title: text(item?.title, 120), text: body });
  }
  return out;
};

/**
 * Забирает заготовку под отправку.
 *
 * Проверяется всё сразу и в одном запросе: та ли заготовка, тот ли
 * человек, тот ли чат, не просрочена ли, не использована ли. Пометка
 * used_at ставится этим же UPDATE — поэтому два одновременных нажатия
 * не отправят сообщение дважды.
 */
export const takeInlinePending = async (pendingId, userId, chatId) => {
  if (!PENDING_ID_RE.test(String(pendingId ?? ''))) return null;
  const { rows } = await query(
    `UPDATE bot_inline_pending SET used_at = now()
      WHERE id = $1 AND user_id = $2 AND chat_id = $3
        AND used_at IS NULL AND expires_at > now()
      RETURNING bot_id, title, text`,
    [pendingId, userId, chatId],
  );
  if (!rows[0]) return null;
  return { botId: rows[0].bot_id, title: rows[0].title, text: decryptContent(rows[0].text) };
};

/** Опубликованный inline-бот по триггеру. Черновики не вызываются. */
export const inlineBotByTrigger = async (trigger) => {
  const t = String(trigger ?? '').replace(/^#/, '').trim().toLowerCase();
  if (!/^[a-z0-9_а-яё]{2,24}$/i.test(t)) return null;
  const { rows } = await query(
    `SELECT id, name, username, icon, accent, inline_placeholder
       FROM bots
      WHERE inline_enabled AND status = 'published' AND lower(inline_trigger) = $1`,
    [t],
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id, name: rows[0].name, username: `@${rows[0].username}`,
    icon: rows[0].icon, accent: rows[0].accent, placeholder: rows[0].inline_placeholder,
  };
};

/** Список inline-ботов для подсказки по # — только опубликованные. */
export const listInlineBots = async (prefix = '') => {
  const p = String(prefix ?? '').replace(/^#/, '').trim().toLowerCase();
  const args = [];
  let where = "inline_enabled AND status = 'published' AND inline_trigger IS NOT NULL";
  if (p) {
    args.push(`${p.replace(/([\\%_])/g, '\\$1')}%`);
    where += ` AND (lower(inline_trigger) LIKE $1 OR lower(name) LIKE $1 OR lower(username) LIKE $1)`;
  }
  const { rows } = await query(
    `SELECT id, name, username, icon, accent, inline_trigger, inline_placeholder, verified,
            EXISTS (SELECT 1 FROM bot_runtimes r
                     WHERE r.bot_id = bots.id AND r.revoked_at IS NULL
                       AND r.last_seen_at > now() - interval '90 seconds') AS online
       FROM bots WHERE ${where} ORDER BY verified DESC, name LIMIT 12`,
    args,
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, username: `@${r.username}`,
    icon: r.icon, accent: r.accent, trigger: r.inline_trigger,
    placeholder: r.inline_placeholder, verified: r.verified, online: r.online === true,
  }));
};

/* ─── Уборка ───────────────────────────────────────────────────────── */

/**
 * Чистит то, что уже никому не нужно.
 *
 * Событие, не забранное за сутки, забирать некому: сервер владельца
 * столько не выключают случайно, а очередь без потолка растёт вечно.
 */
export const sweepBots = async () => {
  const { rowCount: events } = await query(
    "DELETE FROM bot_events WHERE created_at < now() - interval '24 hours'",
  );
  await query("DELETE FROM bot_inline_pending WHERE expires_at < now() - interval '1 hour'");
  await query("DELETE FROM bot_pairings WHERE expires_at < now() - interval '1 day'");
  /* Журнал держим неделю: он нужен, чтобы разобраться в недавнем сбое,
     а не как вечный архив. */
  await query("DELETE FROM bot_log WHERE created_at < now() - interval '7 days'");
  return events;
};
