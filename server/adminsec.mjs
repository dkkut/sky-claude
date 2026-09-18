/**
 * Безопасность панели администратора.
 *
 * Панель — единственное место, откуда управляется вся экосистема, и
 * относиться к ней как к обычной странице нельзя. Этот файл добавляет
 * то, чего у неё не было, не трогая того, что у неё работало.
 *
 * Что здесь есть и зачем:
 *
 *   роли и права   — is_admin был одним тумблером на всё. Человек,
 *                    позванный разбирать жалобы, получал заодно
 *                    телеканалы, склады и выдачу прав;
 *
 *   подтверждение  — украденная сессия сразу давала все критические
 *   личности         действия. Теперь перед опасным спрашивается то,
 *                    чего у чужих рук нет;
 *
 *   два ключа      — один администратор в одиночку заводил второго,
 *                    разжаловал третьего и банил четвёртого. Теперь он
 *                    оформляет заявку, а поворачивает ключ владелец;
 *
 *   журнал         — вырезанную из него строку нельзя было заметить.
 *                    Теперь записи скреплены цепочкой отпечатков;
 *
 *   аварийный режим — при подозрении на компрометацию владелец закрывает
 *                    панель целиком, не трогая обычную жизнь сервиса.
 *
 * Чего здесь нет намеренно: правил, которые ломали бы существующую
 * работу. Администратор без назначенной роли остаётся полноправным, как
 * и был, — сузить роль это отдельное решение владельца, а не побочный
 * эффект выкладки.
 *
 * Правило, общее для всего файла: право спрашивается у базы на каждом
 * действии. Ни роль, ни право, ни признак владельца не читаются из
 * запроса никогда — их присылает тот, чьи права мы и проверяем.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { config } from './config.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { isAdmin, isOwner, setAdminLogSink, rightsOf, can } from './admin.mjs';
import { ROLE_NAMES, ROLE_LABEL } from './roles.mjs';
import { decryptSecret } from './crypto.mjs';
import { verifyTotp } from './totp.mjs';
import { sendEmail } from './notify.mjs';
import { wallet } from './wallet.mjs';
import { grantPrime } from './skyid.mjs';
import { adjustRevenue } from './skyvideo.mjs';

/* ─── Роли и права ─────────────────────────────────────────────────── */

/* Таблица прав лежит в roles.mjs, а ответ на вопрос «есть ли право» — в
   admin.mjs: спрашивают его все модули, а тянуть ради этого кошелёк и
   почту, которые нужны здесь, они не должны. Здесь — только повторный
   вывоз, чтобы панель и сокет продолжали брать всё из одного места. */
export { PERMISSIONS, ROLES, ROLE_NAMES, ROLE_LABEL } from './roles.mjs';
export { rightsOf, can } from './admin.mjs';

/* ─── Журнал безопасности ──────────────────────────────────────────── */

const MAX_DETAIL = 300;

/** Разделитель полей в отпечатке: символ, которого в тексте не бывает. */
const SEP = String.fromCharCode(0);

/** Обезличенная примета источника: «тот же или другой», без самого адреса. */
const fingerprint = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return crypto.createHmac('sha256', `${config.jwtSecret}:admin-meta:v1`)
    .update(s).digest('hex').slice(0, 32);
};

/** Приметы запроса из сокета или из HTTP. Оба места зовут одно и то же. */
export const requestMeta = (req) => ({
  ip: fingerprint(req?.headers?.['x-forwarded-for']?.split(',')[0]
    ?? req?.socket?.remoteAddress ?? ''),
  ua: fingerprint(req?.headers?.['user-agent'] ?? ''),
});

/**
 * Отпечаток записи: содержимое плюс отпечаток предыдущей.
 *
 * Вырезать строку из середины, не тронув всё, что после неё, нельзя —
 * цепочка разойдётся. Это не делает журнал неудаляемым: против того, у
 * кого есть база, база не защищается. Это делает удаление заметным, а
 * заметность и есть то, ради чего журнал ведут.
 */
const linkHash = (prev, row) => crypto
  .createHmac('sha256', `${config.jwtSecret}:admin-log:v1`)
  .update([
    prev ?? '',
    row.id, row.actorId ?? '', row.actorRole ?? '', row.targetId ?? '',
    row.targetType, row.type, row.result, row.detail, row.at,
  ].join(SEP))
  .digest('hex');

/**
 * Записать действие.
 *
 * Пишется и отказ: «попытался и не смог» — как раз то, что показывает
 * подбор прав раньше, чем подбор удастся.
 *
 * Звено цепочки берётся под замком: две записи, сделанные одновременно,
 * иначе взяли бы один и тот же отпечаток предыдущей, и цепочка
 * разветвилась бы.
 */
export const logAdmin = async (entry) => {
  const {
    actorId = null, targetId = null, targetType = 'profile',
    type, result = 'ok', detail = '', meta = {}, requestId = null,
  } = entry;

  const rights = actorId ? await rightsOf(actorId) : { role: null };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Замок по имени цепочки, а не на строке: последней строки может не
       быть вовсе, а замка на несуществующую строку не бывает. */
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['admin_log_chain']);
    const { rows: last } = await client.query(
      'SELECT hash FROM admin_log ORDER BY seq DESC LIMIT 1');

    const id = `al-${crypto.randomUUID()}`;
    const at = new Date().toISOString();
    const shortDetail = String(detail ?? '').slice(0, MAX_DETAIL);
    const hash = linkHash(last[0]?.hash ?? null, {
      id, actorId, actorRole: rights.role, targetId, targetType,
      type: String(type).slice(0, 40), result, detail: shortDetail, at,
    });

    await client.query(
      `INSERT INTO admin_log
         (id, actor_id, target_id, type, detail, actor_role, target_type,
          result, ip_hash, ua_hash, request_id, prev_hash, hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, actorId, targetId, String(type).slice(0, 40),
        encryptContent(shortDetail), rights.role, targetType, result,
        meta.ip ?? null, meta.ua ?? null, requestId,
        last[0]?.hash ?? null, hash, at]);
    await client.query('COMMIT');
    return { id, hash };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    /* Журнал не должен ронять действие: упавшая запись — это плохо, но
       незаписанное действие, которое при этом не выполнилось, хуже.
       Сообщаем в консоль сервера и идём дальше. */
    console.error('[админ] журнал', err.message);
    return { error: 'log_failed' };
  } finally {
    client.release();
  }
};

/* С этой минуты журнал пишет только цепочка. Прямые вставки из
   admin.mjs уходят сюда же: два писателя рвали бы цепочку, и разрыв
   выглядел бы как подделка там, где её не было. */
setAdminLogSink(logAdmin);

/** Событие безопасности: не действие, а то, что происходило. */
export const logSecurityEvent = async (actorId, kind, detail = '', meta = {}) => {
  await query(
    `INSERT INTO admin_security_events (id, actor_id, kind, detail, ip_hash, ua_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [`ase-${crypto.randomUUID()}`, actorId ?? null, String(kind).slice(0, 40),
      String(detail ?? '').slice(0, MAX_DETAIL), meta.ip ?? null, meta.ua ?? null])
    .catch((err) => console.error('[админ] событие', err.message));
};

/**
 * Проверка целостности журнала.
 *
 * Пересчитывает цепочку и говорит, где она расходится. Первая
 * разошедшаяся запись — это то место, где журнал правили.
 */
export const verifyAdminLog = async (actorId, { limit } = {}) => {
  if (!(await can(actorId, 'security'))) return { error: 'not_allowed' };

  const n = Math.min(5000, Math.max(1, Number(limit) || 1000));
  const { rows } = await query(
    `SELECT id, seq, actor_id, actor_role, target_id, target_type, type,
            result, detail, prev_hash, hash, created_at
       FROM admin_log ORDER BY seq DESC LIMIT $1`, [n]);
  const chain = rows.reverse();

  let broken = null;
  let checked = 0;
  let prevHash = null;
  for (const row of chain) {
    /* Записи, сделанные до появления цепочки, не проверяем: отпечатка у
       них нет, и объявлять их подделкой было бы неправдой. */
    if (!row.hash) continue;
    const want = linkHash(row.prev_hash ?? null, {
      id: row.id, actorId: row.actor_id, actorRole: row.actor_role,
      targetId: row.target_id, targetType: row.target_type, type: row.type,
      result: row.result, detail: decryptContent(row.detail) ?? '',
      at: row.created_at.toISOString(),
    });
    checked += 1;
    if (want !== row.hash) { broken = { id: row.id, seq: Number(row.seq) }; break; }
    /* Звено должно ссылаться на предыдущее. Разрыв ссылки — это
       вырезанная строка, даже если сами записи целы. */
    if (prevHash && row.prev_hash !== prevHash) {
      broken = { id: row.id, seq: Number(row.seq), gap: true };
      break;
    }
    prevHash = row.hash;
  }

  await logAdmin({
    actorId, type: 'log_verify', targetType: 'system',
    result: broken ? 'broken' : 'ok',
    detail: broken ? `Цепочка расходится на записи ${broken.id}` : `Проверено записей: ${checked}`,
  });

  return { checked, intact: !broken, broken };
};

/**
 * Журнал администратору.
 *
 * Читать его вправе тот, у кого есть право на безопасность. Раньше его
 * читал любой администратор: список того, кто кого забанил, — это и
 * список того, кого стоит бояться.
 */
export const readAdminLog = async (actorId, { limit } = {}) => {
  if (!(await can(actorId, 'security'))) return null;
  const n = Math.min(300, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    `SELECT id, actor_id, actor_role, target_id, target_type, type, result,
            detail, created_at
       FROM admin_log ORDER BY seq DESC LIMIT $1`, [n]);
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actor_id ?? undefined,
    actorRole: r.actor_role ?? undefined,
    targetId: r.target_id ?? undefined,
    targetType: r.target_type,
    type: r.type,
    result: r.result,
    detail: decryptContent(r.detail) ?? '',
    createdAt: r.created_at.toISOString(),
  }));
};

/** Недавние события безопасности — тому же кругу. */
export const readSecurityEvents = async (actorId, { limit } = {}) => {
  if (!(await can(actorId, 'security'))) return null;
  const n = Math.min(300, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    `SELECT id, actor_id, kind, detail, created_at
       FROM admin_security_events ORDER BY created_at DESC LIMIT $1`, [n]);
  return rows.map((r) => ({
    id: r.id, actorId: r.actor_id ?? undefined, kind: r.kind,
    detail: r.detail, createdAt: r.created_at.toISOString(),
  }));
};

/* ─── Повторное подтверждение личности ─────────────────────────────── */

/**
 * Зачем оно нужно.
 *
 * Обычной авторизации мало для опасного. Украденная сессия — это чужие
 * руки на той же клавиатуре: всё, что уже подтверждено, подтверждено и
 * для них. Подтверждение спрашивает то, чего у чужих рук нет: код из
 * приложения владельца сессии или письмо на его почту.
 *
 * Подтверждение выдаётся под конкретное действие и живёт минуты.
 * Годное на всё и навсегда равно отсутствию подтверждения.
 */

/** Пять минут: дольше человеку код не нужен, а украденному — пригодится. */
const STEP_UP_TTL_SEC = 5 * 60;
/** Три попытки. Шестизначный код перебирается за миллион, но не за три. */
const STEP_UP_ATTEMPTS = 3;

const codeHash = (actorId, purpose, code) => crypto
  .createHmac('sha256', `${config.jwtSecret}:admin-stepup:v1`)
  .update([actorId, purpose, String(code)].join(SEP))
  .digest('hex');

/**
 * Начать подтверждение: выдать код.
 *
 * Способ выбирает не запрос, а состояние аккаунта: есть двухэтапная
 * защита — код из приложения, нет — письмо. Позволить клиенту выбирать
 * способ значило бы позволить ему выбрать самый слабый.
 */
export const beginStepUp = async (actorId, purpose, { meta = {} } = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  const clean = String(purpose ?? '').slice(0, 60);
  if (!clean) return { error: 'bad_purpose' };

  const { rows } = await query(
    `SELECT s.id AS sky_id, s.two_factor_enabled, s.email, s.email_verified
       FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
      WHERE p.id = $1`, [actorId]);
  const acc = rows[0];
  if (!acc) return { error: 'not_allowed' };

  /* Незавершённые подтверждения под то же действие гасим: два живых
     кода на одно действие — это две возможности угадать. */
  await query(
    `UPDATE admin_step_up SET used_at = now()
      WHERE actor_id = $1 AND purpose = $2 AND used_at IS NULL`, [actorId, clean]);

  if (acc.two_factor_enabled) {
    /* Код из приложения сервер не выдаёт — он уже у человека. Заводим
       только запись о том, что подтверждение началось. */
    const id = `asu-${crypto.randomUUID()}`;
    await query(
      `INSERT INTO admin_step_up (id, actor_id, purpose, code_hash, method, expires_at)
       VALUES ($1,$2,$3,$4,'app', now() + ($5 || ' seconds')::interval)`,
      [id, actorId, clean, '', String(STEP_UP_TTL_SEC)]);
    await logSecurityEvent(actorId, 'step_up_begin', `app: ${clean}`, meta);
    return { id, method: 'app', expiresIn: STEP_UP_TTL_SEC };
  }

  /* Второй способ — письмо, и только на подтверждённый адрес:
     неподтверждённый это не «его почта», а «то, что он вписал». */
  const email = acc.email_verified ? String(acc.email ?? '') : '';
  if (!email) return { error: 'no_second_factor' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = `asu-${crypto.randomUUID()}`;
  await query(
    `INSERT INTO admin_step_up (id, actor_id, purpose, code_hash, method, expires_at)
     VALUES ($1,$2,$3,$4,'email', now() + ($5 || ' seconds')::interval)`,
    [id, actorId, clean, codeHash(actorId, clean, code), String(STEP_UP_TTL_SEC)]);

  await sendEmail(email, 'Подтверждение действия в панели Sky',
    `Код подтверждения: ${code}\n\nОн нужен для действия «${clean}» в панели администратора `
    + 'и действует пять минут. Если вы ничего не делали — кто-то вошёл в вашу '
    + 'учётную запись: смените способ входа и сообщите владельцу сервиса.')
    .catch((err) => console.error('[админ] письмо подтверждения', err.message));

  await logSecurityEvent(actorId, 'step_up_begin', `email: ${clean}`, meta);
  return { id, method: 'email', expiresIn: STEP_UP_TTL_SEC };
};

/**
 * Проверить код и пометить подтверждение как использованное.
 *
 * Возвращает true ровно один раз: повторить то же подтверждение вторым
 * действием нельзя. Сравнение идёт побайтово постоянным временем.
 */
export const consumeStepUp = async (actorId, purpose, code, { meta = {} } = {}) => {
  const clean = String(purpose ?? '').slice(0, 60);
  /* Кода нет вовсе — это «подтверди личность», а не «код не тот».
     Отвечать «не тот» на пустой код значило бы подсказывать, есть ли
     сейчас живое подтверждение, и попусту тратить попытку. */
  if (!String(code ?? '').trim()) return { error: 'step_up_required' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM admin_step_up
        WHERE actor_id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [actorId, clean]);
    const row = rows[0];
    if (!row) { await client.query('ROLLBACK'); return { error: 'step_up_required' }; }

    if (row.attempts >= STEP_UP_ATTEMPTS) {
      await client.query('UPDATE admin_step_up SET used_at = now() WHERE id = $1', [row.id]);
      await client.query('COMMIT');
      await logSecurityEvent(actorId, 'step_up_exhausted', clean, meta);
      return { error: 'step_up_exhausted' };
    }

    let good;
    if (row.method === 'app') {
      const { rows: sec } = await client.query(
        `SELECT s.two_factor_secret FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
          WHERE p.id = $1`, [actorId]);
      const secret = decryptSecret(sec[0]?.two_factor_secret);
      good = Boolean(secret) && verifyTotp(secret, String(code ?? ''));
    } else {
      const want = Buffer.from(row.code_hash);
      const got = Buffer.from(codeHash(actorId, clean, String(code ?? '')));
      good = want.length === got.length && crypto.timingSafeEqual(want, got);
    }

    if (!good) {
      await client.query(
        'UPDATE admin_step_up SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      await client.query('COMMIT');
      await logSecurityEvent(actorId, 'step_up_failed', clean, meta);
      return { error: 'step_up_invalid' };
    }

    await client.query('UPDATE admin_step_up SET used_at = now() WHERE id = $1', [row.id]);
    await client.query('COMMIT');
    await logSecurityEvent(actorId, 'step_up_ok', clean, meta);
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Уборка отработавших подтверждений. Зовётся часовой уборкой. */
export const sweepStepUp = async () => {
  const { rowCount } = await query(
    "DELETE FROM admin_step_up WHERE expires_at < now() - interval '1 day'");
  return rowCount;
};

/* ─── Аварийный режим ──────────────────────────────────────────────── */

/**
 * Панель закрыта целиком.
 *
 * Обычная жизнь экосистемы при этом продолжается: люди переписываются,
 * покупают и смотрят кино. Страдать оттого, что у нас что-то случилось,
 * должны мы, а не они.
 *
 * Владелец проходит и в аварийном режиме — иначе включивший его остался
 * бы без способа его выключить.
 */
export const lockdownState = async () => {
  const { rows } = await query('SELECT active, reason, set_at FROM admin_lockdown WHERE id');
  const row = rows[0];
  return {
    active: Boolean(row?.active),
    reason: row?.reason ?? '',
    since: row?.set_at?.toISOString() ?? null,
  };
};

export const setLockdown = async (actorId, on, reason = '', { meta = {} } = {}) => {
  if (!(await isOwner(actorId))) {
    await logAdmin({ actorId, type: 'lockdown', targetType: 'system',
      result: 'denied', detail: 'Не владелец', meta });
    return { error: 'owner_only' };
  }
  await query(
    `UPDATE admin_lockdown SET active = $1, reason = $2, set_by = $3, set_at = now()
      WHERE id`, [Boolean(on), String(reason ?? '').slice(0, 300), actorId]);
  await logAdmin({ actorId, type: on ? 'lockdown_on' : 'lockdown_off',
    targetType: 'system', detail: String(reason ?? '').slice(0, 300), meta });
  return { ...(await lockdownState()) };
};

/* ─── Два ключа: действие подтверждает владелец ────────────────────── */

/**
 * Зачем это нужно.
 *
 * До этого один администратор в одиночку заводил второго, разжаловал
 * третьего и банил четвёртого. Скомпрометированный аккаунт за минуту
 * снимал всех остальных и оставался в системе один.
 *
 * Теперь у опасного два ключа: администратор оформляет заявку, владелец
 * её подтверждает, и только тогда что-то происходит. Один ключ ничего
 * не открывает.
 *
 * Применяется не ко всему — иначе панель встанет. Только к тому, после
 * чего трудно вернуться: права, роли, деньги, аварийные действия.
 */

/** Сутки. Заявка, о которой забыли, не должна ждать вечно. */
const PENDING_TTL_HOURS = 24;

/** Потолок начисления за одну заявку. Страховка от лишнего нуля. */
export const MAX_GRANT_RUBLES = 1_000_000;
export const MAX_GRANT_POINTS = 10_000_000;
export const MAX_GRANT_PRIME_DAYS = 3650;
/** Потолок разовой корректировки дохода по ролику, в копейках. */
export const MAX_REVENUE_ADJUST_KOPECKS = 100_000_00;

/**
 * Виды заявок и что для каждой нужно.
 *
 * `permission` — право, без которого заявку даже не оформить;
 * `stepUp`     — нужно ли подтвердить личность при создании заявки.
 */
export const PENDING_KINDS = {
  admin_grant:   { permission: 'security', stepUp: true,  title: 'Выдать права администратора' },
  admin_revoke:  { permission: 'security', stepUp: true,  title: 'Снять права администратора' },
  role_set:      { permission: 'security', stepUp: true,  title: 'Назначить роль' },
  grant_money:   { permission: 'finance',  stepUp: true,  title: 'Начислить деньги' },
  grant_points:  { permission: 'finance',  stepUp: true,  title: 'Начислить баллы' },
  grant_prime:   { permission: 'finance',  stepUp: true,  title: 'Выдать Prime' },
  skyvideo_revenue_adjust: { permission: 'finance', stepUp: true, title: 'Скорректировать доход по ролику Sky Video' },
};

/**
 * Целое число в разумных пределах — или отказ.
 *
 * Дробное не усекаем, а отклоняем. Усечение означало бы, что владелец
 * подтверждает «1», когда администратор набрал «1.5»: подтверждают
 * ровно то, что видели, и округление здесь — это уже другое число.
 */
const whole = (raw, max) => {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0 || n > max) return null;
  return n;
};

const payloadHash = (kind, targetId, payload) => crypto
  .createHmac('sha256', `${config.jwtSecret}:admin-pending:v1`)
  .update([kind, targetId ?? '', JSON.stringify(payload)].join(SEP))
  .digest('hex');

/**
 * Разобрать и проверить содержимое заявки.
 *
 * Всё, что придёт из запроса, проходит здесь и приводится к числам и
 * известным словам. Дальше по коду идёт уже проверенное: подтверждать
 * владелец будет ровно то, что записано, а не то, что прислали.
 */
const checkPayload = (kind, raw = {}) => {
  switch (kind) {
    case 'admin_grant': {
      /* Роль нужна уже в заявке: правило «администратор без роли —
         полноправный» задумано для тех, кто работал до появления ролей,
         а не для тех, кого заводят сейчас. Без роли новый администратор
         получал бы всё сразу, и владелец подтверждал бы, не видя чего.
         Умолчание — только чтение: отказ по умолчанию. */
      const role = raw.role === undefined || raw.role === null || raw.role === ''
        ? 'read_only_admin' : String(raw.role);
      if (!ROLE_NAMES.includes(role)) return { error: 'bad_role' };
      return { ok: true, payload: { role } };
    }

    case 'admin_revoke':
      return { ok: true, payload: {} };

    case 'role_set': {
      const role = String(raw.role ?? '');
      if (!ROLE_NAMES.includes(role)) return { error: 'bad_role' };
      return { ok: true, payload: { role } };
    }

    case 'grant_money': {
      const amount = whole(raw.amount, MAX_GRANT_RUBLES);
      if (amount === null) return { error: 'bad_amount' };
      return { ok: true, payload: { amount } };
    }

    case 'grant_points': {
      const amount = whole(raw.amount, MAX_GRANT_POINTS);
      if (amount === null) return { error: 'bad_amount' };
      return { ok: true, payload: { amount } };
    }

    case 'grant_prime': {
      const days = whole(raw.days, MAX_GRANT_PRIME_DAYS);
      if (days === null) return { error: 'bad_days' };
      const plan = ['standard', 'year'].includes(String(raw.plan)) ? String(raw.plan) : 'standard';
      return { ok: true, payload: { days, plan } };
    }

    case 'skyvideo_revenue_adjust': {
      const videoId = String(raw.videoId ?? '');
      if (!/^svid-[0-9a-f-]{36}$/.test(videoId)) return { error: 'bad_video' };
      /* Сумма подписанная: минус — это исправление лишнего начисления,
         а не только выдача. Ноль ничего не значил бы, поэтому отклонён. */
      const amount = Math.trunc(Number(raw.amountKopecks));
      if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > MAX_REVENUE_ADJUST_KOPECKS) {
        return { error: 'bad_amount' };
      }
      const note = String(raw.note ?? '').slice(0, 300);
      return { ok: true, payload: { videoId, amountKopecks: amount, note } };
    }

    default:
      return { error: 'bad_kind' };
  }
};

/**
 * Оформить заявку.
 *
 * Право проверяется здесь, а не при подтверждении: заявка, которую
 * оформил тот, кому нельзя, не должна даже попасть владельцу на глаза —
 * иначе очередь превращается в способ просить чужими руками.
 */
export const createPendingAction = async (actorId, kind, targetId, raw = {}, opts = {}) => {
  const { stepUpCode, reason = '', meta = {} } = opts;
  const spec = PENDING_KINDS[String(kind ?? '')];
  if (!spec) return { error: 'bad_kind' };

  if (!(await can(actorId, spec.permission))) {
    await logAdmin({ actorId, targetId, type: `${kind}_request`, result: 'denied',
      detail: 'Нет права', meta });
    return { error: 'not_allowed' };
  }

  const lock = await lockdownState();
  if (lock.active && !(await isOwner(actorId))) return { error: 'lockdown' };

  const target = String(targetId ?? '');
  if (!target) return { error: 'not_found' };
  const { rows: who } = await query(
    'SELECT id, username, is_admin FROM profiles WHERE id = $1', [target]);
  if (!who[0]) return { error: 'not_found' };

  /* Владельца не трогает никакая заявка. Ни выдать ему роль, ни снять
     права, ни «начислить» — он вне очереди по определению. */
  if (await isOwner(target)) return { error: 'owner_protected' };

  /* Себе — нельзя. Ни прав, ни роли, ни денег: заявка на себя, которую
     подтверждает владелец, всё равно остаётся способом попросить у
     владельца то, чего сам себе выдать не можешь, а вот заявка на
     деньги себе — это уже прямой соблазн. */
  if (target === actorId) return { error: 'self_target' };

  const checked = checkPayload(kind, raw);
  if (checked.error) return checked;

  if (kind === 'skyvideo_revenue_adjust') {
    /* Ролик должен принадлежать именно тому, на кого оформлена заявка —
       иначе владелец подтверждал бы начисление на счёт одного человека,
       глядя на имя другого. */
    const { rows: vids } = await query(
      'SELECT owner_id FROM sky_videos WHERE id = $1', [checked.payload.videoId]);
    if (!vids[0]) return { error: 'not_found' };
    if (vids[0].owner_id !== target) return { error: 'video_owner_mismatch' };
  }

  if (spec.stepUp) {
    const step = await consumeStepUp(actorId, `pending:${kind}`, stepUpCode, { meta });
    if (step.error) return step;
  }

  const id = `apa-${crypto.randomUUID()}`;
  await query(
    `INSERT INTO admin_pending_actions
       (id, kind, actor_id, target_id, payload_enc, payload_hash, reason, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' hours')::interval)`,
    [id, kind, actorId, target,
      encryptContent(JSON.stringify(checked.payload)),
      payloadHash(kind, target, checked.payload),
      String(reason ?? '').slice(0, 300), String(PENDING_TTL_HOURS)]);

  await logAdmin({ actorId, targetId: target, type: `${kind}_request`,
    detail: `${spec.title}: ${JSON.stringify(checked.payload)}`, meta });

  return { id, kind, targetId: target, status: 'pending', payload: checked.payload };
};

const toPending = (row) => ({
  id: row.id,
  kind: row.kind,
  title: PENDING_KINDS[row.kind]?.title ?? row.kind,
  actorId: row.actor_id,
  actorName: row.actor_name ?? undefined,
  targetId: row.target_id,
  targetName: row.target_name ?? undefined,
  payload: (() => {
    try { return JSON.parse(decryptContent(row.payload_enc) ?? '{}'); }
    catch { return {}; }
  })(),
  reason: row.reason,
  status: row.status,
  outcome: row.outcome,
  decisionNote: row.decision_note,
  decidedAt: row.decided_at?.toISOString?.() ?? null,
  executedAt: row.executed_at?.toISOString?.() ?? null,
  expiresAt: row.expires_at?.toISOString?.() ?? null,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

const SELECT_PENDING = `
  SELECT a.*, p.username AS actor_name, t.username AS target_name
    FROM admin_pending_actions a
    LEFT JOIN profiles p ON p.id = a.actor_id
    LEFT JOIN profiles t ON t.id = a.target_id`;

/**
 * Очередь заявок.
 *
 * Владелец видит все. Администратор — только свои: чужая заявка на
 * выдачу прав это сведения о том, кто кого собирается назначить.
 */
export const listPendingActions = async (actorId, { status, limit } = {}) => {
  if (!(await isAdmin(actorId))) return null;
  const owner = await isOwner(actorId);
  const n = Math.min(200, Math.max(1, Number(limit) || 50));

  const args = [];
  const where = [];
  if (!owner) { args.push(actorId); where.push(`a.actor_id = $${args.length}`); }
  const wanted = String(status ?? '');
  if (['pending', 'approved', 'rejected', 'executed', 'failed', 'expired'].includes(wanted)) {
    args.push(wanted); where.push(`a.status = $${args.length}`);
  }
  args.push(n);

  const { rows } = await query(
    `${SELECT_PENDING}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC LIMIT $${args.length}`, args);
  return rows.map(toPending);
};

/**
 * Решение владельца.
 *
 * Подтверждать вправе только он: в этом весь смысл второго ключа.
 * Администратор своей же заявки подтвердить не может, даже если он
 * администратор безопасности, — иначе ключей снова один.
 *
 * Отпечаток слепка сверяется перед выполнением: подтверждают ровно то,
 * что видели. Иначе заявка «начислить 100 ₽» превращалась бы в «100 000»
 * между показом и нажатием.
 */
export const decidePendingAction = async (actorId, id, approve, opts = {}) => {
  const { stepUpCode, note = '', meta = {} } = opts;

  if (!(await isOwner(actorId))) {
    await logAdmin({ actorId, type: 'pending_decide', targetType: 'pending',
      result: 'denied', detail: 'Подтверждать вправе только владелец', meta });
    return { error: 'owner_only' };
  }

  /* Владелец тоже подтверждает личность: украденная сессия владельца —
     это худшее, что может случиться, и второй ключ не должен
     поворачиваться одной только украденной кукой. */
  const step = await consumeStepUp(actorId, 'pending:decide', stepUpCode, { meta });
  if (step.error) return step;

  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM admin_pending_actions WHERE id = $1 FOR UPDATE`, [String(id ?? '')]);
    row = rows[0];
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { error: 'already_decided', status: row.status };
    }
    if (row.expires_at <= new Date()) {
      await client.query(
        `UPDATE admin_pending_actions SET status = 'expired' WHERE id = $1`, [row.id]);
      await client.query('COMMIT');
      return { error: 'expired' };
    }

    /* Переход пишем условием самого UPDATE: из двух одновременных
       нажатий срабатывает ровно одно. */
    const { rowCount } = await client.query(
      `UPDATE admin_pending_actions
          SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
        WHERE id = $1 AND status = 'pending'`,
      [row.id, approve ? 'approved' : 'rejected', actorId,
        String(note ?? '').slice(0, 300)]);
    if (!rowCount) { await client.query('ROLLBACK'); return { error: 'already_decided' }; }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (!approve) {
    await logAdmin({ actorId, targetId: row.target_id, type: `${row.kind}_rejected`,
      targetType: 'pending', detail: String(note ?? '').slice(0, 300), meta });
    const after = await query(`${SELECT_PENDING} WHERE a.id = $1`, [row.id]);
    return { action: toPending(after.rows[0]) };
  }

  /* Слепок сверяем перед выполнением. Правка строки в базе между
     созданием и подтверждением не должна превратиться в другое
     действие, которого владелец не видел. */
  let payload;
  try { payload = JSON.parse(decryptContent(row.payload_enc) ?? '{}'); }
  catch { payload = null; }
  const want = payloadHash(row.kind, row.target_id, payload ?? {});
  if (!payload || want !== row.payload_hash) {
    await query(
      `UPDATE admin_pending_actions SET status = 'failed', outcome = $2 WHERE id = $1`,
      [row.id, 'Слепок заявки не сходится']);
    await logAdmin({ actorId, targetId: row.target_id, type: `${row.kind}_tampered`,
      targetType: 'pending', result: 'broken', detail: 'Слепок заявки не сходится', meta });
    return { error: 'payload_tampered' };
  }

  const done = await executePending(row, payload, actorId);
  await query(
    `UPDATE admin_pending_actions
        SET status = $2, executed_at = now(), outcome = $3 WHERE id = $1`,
    [row.id, done.error ? 'failed' : 'executed',
      done.error ? String(done.error).slice(0, 200) : String(done.outcome ?? 'Выполнено').slice(0, 200)]);

  await logAdmin({ actorId, targetId: row.target_id,
    type: done.error ? `${row.kind}_failed` : `${row.kind}_executed`,
    result: done.error ? 'failed' : 'ok',
    detail: done.error ? String(done.error) : String(done.outcome ?? ''), meta });

  const after = await query(`${SELECT_PENDING} WHERE a.id = $1`, [row.id]);
  return done.error ? { error: done.error, action: toPending(after.rows[0]) }
    : { action: toPending(after.rows[0]) };
};

/** Уборка заявок, которых так и не коснулись. */
export const sweepPendingActions = async () => {
  const { rowCount } = await query(
    `UPDATE admin_pending_actions SET status = 'expired'
      WHERE status = 'pending' AND expires_at < now()`);
  return rowCount;
};

/* ─── Выполнение подтверждённого ───────────────────────────────────── */

/**
 * Что происходит после поворота второго ключа.
 *
 * Каждое действие здесь идёт через тот же код, которым оно делалось бы
 * обычным путём: деньги — через кошелёк с его блокировкой строки, Prime
 * — через ту же выдачу подписки. Своего пути к балансу у панели нет и
 * быть не должно: два пути к одному счёту однажды разойдутся.
 *
 * Владелец при этом остаётся неприкосновенным и здесь — проверка стоит
 * второй раз. Первая была при создании заявки, но между созданием и
 * подтверждением проходят часы, и за это время человек мог стать
 * владельцем.
 */
const executePending = async (row, payload, ownerId) => {
  const target = row.target_id;
  if (!target) return { error: 'not_found' };
  if (await isOwner(target)) return { error: 'owner_protected' };

  switch (row.kind) {
    case 'admin_grant': {
      const role = ROLE_NAMES.includes(String(payload.role)) ? String(payload.role) : 'read_only_admin';
      /* Роль ставится тем же запросом, что и признак администратора.
         Двумя запросами между ними был бы промежуток, в котором человек
         уже администратор, но ещё без роли, то есть полноправный. */
      const { rowCount } = await query(
        `UPDATE profiles
            SET is_admin = TRUE, admin_role = $2,
                admin_role_set_at = now(), admin_role_set_by = $3
          WHERE id = $1`, [target, role, ownerId]);
      if (!rowCount) return { error: 'not_found' };
      return { outcome: `Права выданы, роль: ${ROLE_LABEL[role] ?? role}` };
    }

    case 'admin_revoke': {
      /* Роль снимаем вместе с правами: иначе повторная выдача вернула бы
         человека полноправным, потому что роли у него не осталось. */
      const { rowCount } = await query(
        'UPDATE profiles SET is_admin = FALSE, admin_role = NULL WHERE id = $1', [target]);
      if (!rowCount) return { error: 'not_found' };
      return { outcome: 'Права сняты' };
    }

    case 'role_set': {
      const role = String(payload.role ?? '');
      if (!ROLE_NAMES.includes(role)) return { error: 'bad_role' };
      const { rowCount } = await query(
        `UPDATE profiles SET admin_role = $2, admin_role_set_at = now(), admin_role_set_by = $3
          WHERE id = $1 AND is_admin`, [target, role, ownerId]);
      if (!rowCount) return { error: 'not_an_admin' };
      return { outcome: `Роль: ${ROLE_LABEL[role] ?? role}` };
    }

    case 'grant_money': {
      const amount = Number(payload.amount);
      const res = await wallet.adminGrant(target, amount, 'money',
        `Начисление по решению владельца (заявка ${row.id})`, row.id);
      if (res.error) return { error: res.error };
      return { outcome: `Начислено ${amount} ₽, баланс ${res.balance}` };
    }

    case 'grant_points': {
      const amount = Number(payload.amount);
      const res = await wallet.adminGrant(target, amount, 'points',
        `Начисление баллов по решению владельца (заявка ${row.id})`, row.id);
      if (res.error) return { error: res.error };
      return { outcome: `Начислено ${amount} баллов, всего ${res.points}` };
    }

    case 'grant_prime': {
      const days = Number(payload.days);
      const { rows } = await query('SELECT sky_id FROM profiles WHERE id = $1', [target]);
      const skyId = rows[0]?.sky_id;
      if (!skyId) return { error: 'not_found' };
      const res = await grantPrime(skyId, target, payload.plan ?? 'standard', days);
      if (res.error) return { error: res.error };
      return { outcome: `Prime на ${days} дн.` };
    }

    case 'skyvideo_revenue_adjust': {
      const amount = Number(payload.amountKopecks);
      const res = await adjustRevenue(payload.videoId, ownerId, amount, payload.note);
      if (res.error) return { error: res.error };
      const rubles = (amount / 100).toFixed(2);
      return { outcome: `${amount >= 0 ? 'Начислено' : 'Списано'} ${Math.abs(Number(rubles))} ₽ по ролику ${payload.videoId}` };
    }

    default:
      return { error: 'bad_kind' };
  }
};

/* ─── Роль и права: чтение и показ ─────────────────────────────────── */

/**
 * Список администраторов с их ролями — для панели.
 *
 * Отдаётся тому, у кого есть право на безопасность. Обычному
 * администратору список коллег не нужен для работы, а как сведения он
 * ценен не ему.
 */
export const listAdminsWithRoles = async (actorId) => {
  if (!(await can(actorId, 'security'))) return null;
  const { rows } = await query(
    `SELECT p.id, p.username, p.name, p.admin_role, p.admin_role_set_at,
            p.banned_until, s.blocked_until
       FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
      WHERE p.is_admin ORDER BY p.username`);
  const out = [];
  for (const r of rows) {
    const owner = await isOwner(r.id);
    out.push({
      id: r.id,
      username: r.username,
      name: r.name,
      role: owner ? 'owner' : (r.admin_role ?? 'super_admin'),
      /* Прежний администратор без назначенной роли. Показываем это
         честно: владельцу стоит знать, у кого права шире нужного. */
      legacy: !owner && !r.admin_role,
      owner,
      roleSetAt: r.admin_role_set_at?.toISOString?.() ?? null,
      banned: Boolean(r.banned_until && r.banned_until > new Date()),
      blocked: Boolean(r.blocked_until && r.blocked_until > new Date()),
    });
  }
  return out;
};

/**
 * Найти человека по нику или идентификатору — для панели.
 *
 * Нужен, чтобы администратор не вводил acc-… руками: ошибка в одном
 * знаке означала бы запрет не тому. Отдаётся только тому, у кого есть
 * право модерации, и только то, что нужно для решения: кто это, и что с
 * ним уже сделано.
 *
 * Ни почты, ни телефона, ни заметок — для запрета они не нужны, а как
 * сведения о человеке ценны.
 */
export const findPerson = async (actorId, queryText) => {
  if (!(await can(actorId, 'moderation'))) return null;
  const raw = String(queryText ?? '').trim().replace(/^@/, '').slice(0, 64);
  if (raw.length < 2) return [];

  const { rows } = await query(
    `SELECT p.id, p.username, p.name, p.is_admin, p.banned_until,
            s.blocked_until, s.blocked_reason,
            (SELECT count(*) FROM profiles o WHERE o.sky_id = p.sky_id)::int AS profiles
       FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
      WHERE p.id = $1 OR lower(p.username) = lower($1) OR p.username ILIKE $2
      ORDER BY (lower(p.username) = lower($1)) DESC, p.username
      LIMIT 20`, [raw, `%${raw}%`]);

  const now = new Date();
  const out = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      username: r.username,
      name: r.name,
      admin: r.is_admin === true,
      owner: await isOwner(r.id),
      banned: Boolean(r.banned_until && r.banned_until > now),
      bannedUntil: r.banned_until && r.banned_until > now ? r.banned_until.toISOString() : null,
      blocked: Boolean(r.blocked_until && r.blocked_until > now),
      blockedUntil: r.blocked_until && r.blocked_until > now ? r.blocked_until.toISOString() : null,
      blockedReason: r.blocked_until && r.blocked_until > now ? (r.blocked_reason ?? '') : '',
      /* Сколько профилей в этой учётной записи. Отсюда видно, почему бан
         одного профиля может ничего не решить. */
      profiles: Number(r.profiles ?? 1),
    });
  }
  return out;
};

/** Свои права — чтобы панель рисовала только то, что человеку доступно. */
export const myRights = async (actorId) => {
  const rights = await rightsOf(actorId);
  return {
    admin: rights.admin,
    owner: rights.owner,
    role: rights.role,
    roleLabel: rights.owner ? 'Владелец' : (ROLE_LABEL[rights.role] ?? rights.role ?? ''),
    permissions: rights.permissions,
    legacy: Boolean(rights.legacy),
    /* Панель должна суметь объяснить пустые права, а не просто их
       показать: «прав нет» и «прав нет, потому что не включён второй
       фактор, срок истёк 3 дня назад» — разные экраны. */
    twoFactor: Boolean(rights.twoFactor),
    twoFactorDue: rights.twoFactorDue ?? null,
    twoFactorRequired: Boolean(rights.twoFactorRequired),
    lockdown: await lockdownState(),
  };
};

export { ROLE_LABEL as ADMIN_ROLE_LABEL };
