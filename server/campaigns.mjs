/**
 * Мероприятия: награда за подтверждённую активность.
 *
 * Не путать с «мероприятиями» Sky Tickets (ticket_events — концерты,
 * билеты). Здесь второй, самостоятельный смысл того же слова —
 * маркетинговая кампания с наградой за выполненное условие. Отдельные
 * таблицы, свой префикс id, своё право 'campaigns' — см. заголовок
 * миграции 062.
 *
 * Первое мероприятие — «Опубликуй видео и получи Sky Prime». У Sky нет
 * доступа к API внешних соцсетей и нечем проверить настоящее число
 * просмотров ролика. Единственное, что сервер способен посчитать сам,
 * не веря клиенту на слово, — переходы по собственной ссылке участника
 * (campaign_clicks, свой посетитель считается не больше одного раза).
 * Это и есть «просмотры» в терминах этого модуля. Сам факт публикации
 * и её содержание подтверждает вручную поддержка при выдаче награды —
 * то же самое «ручная проверка», о которой сказано в разделе про
 * антифрод: автоматически подтвердить видео с внешней площадки нельзя,
 * и переводить это на ручную проверку — единственный честный путь.
 *
 * Выдача Prime не имеет своего пути к подписке: заявка идёт через
 * существующую систему «владелец подтверждает» (adminsec.mjs,
 * PENDING_KINDS.campaign_reward), тем же приёмом, что и любое другое
 * начисление Prime в панели администратора. Обращение — через
 * существующую поддержку (support.mjs), отдельной системы тикетов нет.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { can } from './admin.mjs';
import { hashCode, codesEqual, encryptContent, decryptContent } from './crypto.mjs';
import { createTicket, replyToTicket } from './support.mjs';
import { listStoredIds as listStoredCoverIds, remove as removeCover } from './campaignstore.mjs';

const newId = (p) => `${p}-${crypto.randomUUID()}`;

const text = (v, max) => Array.from(String(v ?? ''))
  .filter((ch) => ch.charCodeAt(0) > 31)
  .join('')
  .trim()
  .slice(0, max);

const int = (v, min, max) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return n < min || n > max ? null : n;
};

const MAX_TITLE = 140;
const MAX_DESC = 4000;
const MAX_CONDITIONS = 4000;
const MAX_VIDEO_URL = 500;
const MAX_LEVELS_PER_CAMPAIGN = 20;
const MAX_REWARD_DAYS = 90;

/** Сколько кликов с разных «посетителей» участия можно принять в минуту — выше уже накрутка, а не органика. */
const CLICK_BURST_PER_MIN = 30;

export const CAMPAIGN_ID_RE = /^camp-[0-9a-f-]{36}$/;
export const PARTICIPATION_ID_RE = /^cpp-[0-9a-f-]{36}$/;
export const LEVEL_ID_RE = /^cplv-[0-9a-f-]{36}$/;
export const GRANT_ID_RE = /^cprg-[0-9a-f-]{36}$/;

/* ─── Представление наружу ────────────────────────────────────────────── */

const toCampaign = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  conditions: row.conditions,
  rewardKind: row.reward_kind,
  hasCover: row.has_cover,
  startsAt: row.starts_at?.toISOString?.() ?? null,
  endsAt: row.ends_at?.toISOString?.() ?? null,
  active: row.active,
  archived: row.archived,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

const toLevel = (row) => ({
  id: row.id,
  campaignId: row.campaign_id,
  viewsThreshold: row.views_threshold,
  rewardDays: row.reward_days,
  sortOrder: row.sort_order,
  active: row.active,
});

/** Уровень, которого участник фактически достиг — самый высокий подошедший порог, без суммирования. */
const levelReached = (levels, views) => {
  const eligible = levels
    .filter((l) => l.active && l.views_threshold <= views)
    .sort((a, b) => b.views_threshold - a.views_threshold);
  return eligible[0] ?? null;
};

const toParticipation = async (row) => {
  const { rows: clickRows } = await query(
    `SELECT count(*)::int AS n FROM campaign_clicks WHERE participation_id = $1`, [row.id]);
  const views = clickRows[0]?.n ?? 0;
  const { rows: levelRows } = await query(
    `SELECT * FROM campaign_levels WHERE campaign_id = $1 ORDER BY views_threshold`, [row.campaign_id]);
  const levels = levelRows.map(toLevel);
  const reached = levelReached(levelRows, views);
  const next = levelRows
    .filter((l) => l.active && l.views_threshold > views)
    .sort((a, b) => a.views_threshold - b.views_threshold)[0];
  const { rows: grantRows } = await query(
    `SELECT g.*, l.views_threshold, l.reward_days AS level_days
       FROM campaign_reward_grants g JOIN campaign_levels l ON l.id = g.level_id
      WHERE g.participation_id = $1 ORDER BY g.created_at DESC`, [row.id]);

  return {
    id: row.id,
    campaignId: row.campaign_id,
    videoUrl: row.video_url,
    status: row.status,
    views,
    currentLevel: reached ? toLevel(reached) : null,
    nextLevel: next ? toLevel(next) : null,
    levels,
    grants: grantRows.map((g) => ({
      id: g.id,
      levelId: g.level_id,
      viewsThreshold: g.views_threshold,
      rewardDays: g.level_days,
      viewsAtRequest: g.views_at_request,
      status: g.status,
      ticketId: g.ticket_id,
      grantedAt: g.granted_at?.toISOString?.() ?? null,
      createdAt: g.created_at.toISOString(),
    })),
    createdAt: row.created_at.toISOString(),
  };
};

/* ─── Публичный список и карточка ─────────────────────────────────────── */

export const listActiveCampaigns = async () => {
  const { rows } = await query(
    `SELECT * FROM campaigns
      WHERE active AND NOT archived
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at > now())
      ORDER BY created_at DESC`);
  return rows.map(toCampaign);
};

export const campaignDetail = async (campaignId) => {
  if (!CAMPAIGN_ID_RE.test(String(campaignId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
  if (!rows[0]) return null;
  const { rows: levels } = await query(
    `SELECT * FROM campaign_levels WHERE campaign_id = $1 AND active ORDER BY views_threshold`, [campaignId]);
  return { ...toCampaign(rows[0]), levels: levels.map(toLevel) };
};

/* ─── Участие ──────────────────────────────────────────────────────────── */

export const linkPayload = (participationId, token) => `${participationId}:${token}`;
const parseLinkPayload = (raw) => {
  const s = String(raw ?? '');
  const i = s.indexOf(':');
  if (i < 0) return null;
  const participationId = s.slice(0, i);
  const token = s.slice(i + 1);
  if (!PARTICIPATION_ID_RE.test(participationId) || !/^[\w-]{20,64}$/.test(token)) return null;
  return { participationId, token };
};

/**
 * Участвовать: одна запись на человека на кампанию. Повторное нажатие
 * возвращает уже существующее участие, а не заводит второе — ON
 * CONFLICT здесь и есть вся защита от гонки двух одновременных нажатий
 * «Участвовать».
 */
export const joinCampaign = async (campaignId, profileId, { videoUrl } = {}) => {
  if (!CAMPAIGN_ID_RE.test(String(campaignId ?? ''))) return { error: 'not_found' };
  const { rows: campRows } = await query(
    `SELECT id FROM campaigns WHERE id = $1 AND active AND NOT archived
       AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`,
    [campaignId]);
  if (!campRows[0]) return { error: 'not_found' };

  const id = newId('cpp');
  const token = crypto.randomBytes(24).toString('base64url');
  const { rows: inserted } = await query(
    `INSERT INTO campaign_participations (id, campaign_id, profile_id, token_enc, video_url)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (campaign_id, profile_id) DO NOTHING
     RETURNING id`,
    [id, campaignId, profileId, encryptContent(token), text(videoUrl, MAX_VIDEO_URL)]);

  if (inserted[0]) return { id, link: linkPayload(id, token) };

  const { rows: existing } = await query(
    'SELECT id, token_enc FROM campaign_participations WHERE campaign_id = $1 AND profile_id = $2',
    [campaignId, profileId]);
  const row = existing[0];
  return { id: row.id, link: linkPayload(row.id, decryptContent(row.token_enc)), alreadyJoined: true };
};

/** Своя ссылка, в любой момент — токен хранится обратимо специально ради этого. Перевыпуск инвалидирует старую тем же приёмом, что и QR заказа в Sky PVZ. */
export const myLink = async (participationId, profileId, { regenerate = false } = {}) => {
  if (!PARTICIPATION_ID_RE.test(String(participationId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT id, profile_id, token_enc FROM campaign_participations WHERE id = $1', [participationId]);
  const row = rows[0];
  if (!row || row.profile_id !== profileId) return { error: 'not_found' };

  if (!regenerate) return { link: linkPayload(participationId, decryptContent(row.token_enc)) };
  const token = crypto.randomBytes(24).toString('base64url');
  await query('UPDATE campaign_participations SET token_enc = $2, updated_at = now() WHERE id = $1',
    [participationId, encryptContent(token)]);
  return { link: linkPayload(participationId, token) };
};

export const myParticipation = async (campaignId, profileId) => {
  if (!CAMPAIGN_ID_RE.test(String(campaignId ?? ''))) return null;
  const { rows } = await query(
    'SELECT * FROM campaign_participations WHERE campaign_id = $1 AND profile_id = $2', [campaignId, profileId]);
  if (!rows[0]) return null;
  return toParticipation(rows[0]);
};

/** Обезличенная примета посетителя: тот же приём, что fingerprint в adminsec.mjs. */
const visitorHash = (ip, userAgent, participationId) => crypto
  .createHash('sha256')
  .update(`${participationId}\u0000${String(ip ?? '')}\u0000${String(userAgent ?? '').slice(0, 200)}`)
  .digest('base64url');

/**
 * Переход по ссылке участника. Публично, без входа — ссылку кликает
 * зритель ролика, не сам участник. Один и тот же посетитель считается
 * не больше раза на участие (UNIQUE в базе, не проверка кодом), а
 * всплеск множества разных посетителей за минуту помечает участие
 * подозрительным — не отклоняет, а переводит на ручную проверку,
 * ровно как того просит сценарий.
 */
export const recordClick = async (raw, { ip, userAgent } = {}) => {
  const parsed = parseLinkPayload(raw);
  if (!parsed) return { error: 'bad_link' };

  const { rows } = await query(
    'SELECT id, token_enc, status FROM campaign_participations WHERE id = $1', [parsed.participationId]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  const real = decryptContent(row.token_enc);
  if (!real || !codesEqual(hashCode(parsed.token, row.id), hashCode(real, row.id))) return { error: 'bad_link' };

  const visitor = visitorHash(ip, userAgent, row.id);
  const { rowCount } = await query(
    `INSERT INTO campaign_clicks (participation_id, visitor_hash) VALUES ($1,$2)
     ON CONFLICT (participation_id, visitor_hash) DO NOTHING`,
    [row.id, visitor]);

  if (rowCount > 0) {
    const { rows: burst } = await query(
      `SELECT count(*)::int AS n FROM campaign_clicks
        WHERE participation_id = $1 AND created_at > now() - interval '1 minute'`, [row.id]);
    if ((burst[0]?.n ?? 0) > CLICK_BURST_PER_MIN && row.status === 'active') {
      await query(
        `UPDATE campaign_participations SET status = 'suspicious',
            suspicious_reason = 'Слишком много переходов за минуту', updated_at = now()
          WHERE id = $1`, [row.id]);
    }
  }
  return { ok: true, participationId: row.id };
};

/* ─── Запрос награды ───────────────────────────────────────────────────── */

/**
 * Запросить подарок. Уровень и его размер сервер определяет сам по
 * фактическому числу переходов — не по тому, что прислал бы клиент.
 * Заявка (campaign_reward_grants) со своим уникальным ограничением на
 * пару (участие, уровень) не даёt тот же уровень запросить дважды: та
 * же форма защиты, что у комиссии ПВЗ.
 */
export const requestReward = async (participationId, profileId) => {
  if (!PARTICIPATION_ID_RE.test(String(participationId ?? ''))) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM campaign_participations WHERE id = $1 FOR UPDATE', [participationId]);
    const part = rows[0];
    if (!part || part.profile_id !== profileId) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (part.status === 'blocked') { await client.query('ROLLBACK'); return { error: 'blocked' }; }

    const { rows: levelRows } = await client.query(
      'SELECT * FROM campaign_levels WHERE campaign_id = $1 AND active ORDER BY views_threshold', [part.campaign_id]);
    const { rows: clickRows } = await client.query(
      'SELECT count(*)::int AS n FROM campaign_clicks WHERE participation_id = $1', [participationId]);
    const views = clickRows[0]?.n ?? 0;
    const level = levelReached(levelRows, views);
    if (!level) { await client.query('ROLLBACK'); return { error: 'no_level_reached' }; }

    const { rows: campRows } = await client.query('SELECT title FROM campaigns WHERE id = $1', [part.campaign_id]);
    const { rows: profRows } = await client.query('SELECT sky_id, username FROM profiles WHERE id = $1', [profileId]);

    const grantId = newId('cprg');
    let inserted;
    try {
      const r = await client.query(
        `INSERT INTO campaign_reward_grants (id, participation_id, level_id, views_at_request, reward_days)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [grantId, participationId, level.id, views, level.reward_days]);
      inserted = r.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      if (String(err.code) === '23505') return { error: 'already_requested' };
      throw err;
    }

    const body = [
      `Заявка на награду мероприятия.`,
      ``,
      `Мероприятие: ${campRows[0]?.title ?? part.campaign_id}`,
      `Sky ID: ${profRows[0]?.sky_id ?? ''}`,
      `Участник: @${profRows[0]?.username ?? profileId}`,
      `Участие: ${participationId}`,
      `Ссылка на ролик: ${part.video_url || '(не указана)'}`,
      `Подтверждённых переходов: ${views}`,
      `Достигнутый уровень: ${level.views_threshold} → ${level.reward_days} дн. Prime`,
      `Статус антифрод-проверки: ${part.status === 'suspicious' ? `подозрительно — ${part.suspicious_reason}` : 'без замечаний'}`,
      `Заявка на награду: ${grantId}`,
    ].join('\n');
    const ticketRes = await createTicket(profileId, {
      subject: `Награда за мероприятие: ${campRows[0]?.title ?? ''}`.slice(0, 200),
      body, kind: 'question',
    });
    if (ticketRes.error) { await client.query('ROLLBACK'); return ticketRes; }

    await client.query(
      'UPDATE campaign_reward_grants SET ticket_id = $2 WHERE id = $1', [grantId, ticketRes.ticket.id]);
    await client.query('COMMIT');
    return { id: inserted.id, ticketId: ticketRes.ticket.id, rewardDays: level.reward_days };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Администрирование: мероприятия ──────────────────────────────────── */

export const listCampaignsForAdmin = async (adminId) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM campaigns ORDER BY created_at DESC');
  return rows.map(toCampaign);
};

const checkCampaignInput = (raw) => {
  const title = text(raw.title, MAX_TITLE);
  if (!title) return { error: 'bad_title' };
  const startsAt = raw.startsAt ? new Date(raw.startsAt) : null;
  const endsAt = raw.endsAt ? new Date(raw.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) return { error: 'bad_starts_at' };
  if (endsAt && Number.isNaN(endsAt.getTime())) return { error: 'bad_ends_at' };
  if (startsAt && endsAt && startsAt >= endsAt) return { error: 'bad_window' };
  return {
    ok: true,
    value: {
      title,
      description: text(raw.description, MAX_DESC),
      conditions: text(raw.conditions, MAX_CONDITIONS),
      startsAt, endsAt,
    },
  };
};

export const createCampaign = async (adminId, raw = {}) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const checked = checkCampaignInput(raw);
  if (checked.error) return checked;
  const v = checked.value;
  const id = newId('camp');
  await query(
    `INSERT INTO campaigns (id, title, description, conditions, starts_at, ends_at, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)`,
    [id, v.title, v.description, v.conditions, v.startsAt, v.endsAt, adminId]);
  return { id };
};

export const updateCampaign = async (adminId, campaignId, raw = {}) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT id FROM campaigns WHERE id = $1', [String(campaignId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const checked = checkCampaignInput(raw);
  if (checked.error) return checked;
  const v = checked.value;
  await query(
    `UPDATE campaigns SET title = $2, description = $3, conditions = $4,
        starts_at = $5, ends_at = $6, updated_at = now() WHERE id = $1`,
    [campaignId, v.title, v.description, v.conditions, v.startsAt, v.endsAt]);
  return { ok: true };
};

export const setCampaignActive = async (adminId, campaignId, active) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rowCount } = await query(
    'UPDATE campaigns SET active = $2, updated_at = now() WHERE id = $1 AND NOT archived',
    [String(campaignId ?? ''), Boolean(active)]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

/** Архив — не удаление: у мероприятия могут быть выданные награды, их история не стирается. */
export const archiveCampaign = async (adminId, campaignId) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rowCount } = await query(
    `UPDATE campaigns SET archived = TRUE, active = FALSE, updated_at = now() WHERE id = $1`,
    [String(campaignId ?? '')]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

/* ─── Администрирование: шкала уровней ────────────────────────────────── */

export const listLevels = async (adminId, campaignId) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows } = await query(
    'SELECT * FROM campaign_levels WHERE campaign_id = $1 ORDER BY views_threshold', [String(campaignId ?? '')]);
  return rows.map(toLevel);
};

export const createLevel = async (adminId, campaignId, raw = {}) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows: camp } = await query('SELECT id FROM campaigns WHERE id = $1', [String(campaignId ?? '')]);
  if (!camp[0]) return { error: 'not_found' };
  const { rows: count } = await query(
    'SELECT count(*)::int AS n FROM campaign_levels WHERE campaign_id = $1', [campaignId]);
  if ((count[0]?.n ?? 0) >= MAX_LEVELS_PER_CAMPAIGN) return { error: 'too_many_levels' };

  const viewsThreshold = int(raw.viewsThreshold, 1, 1_000_000_000);
  const rewardDays = int(raw.rewardDays, 1, MAX_REWARD_DAYS);
  if (viewsThreshold === null) return { error: 'bad_views' };
  if (rewardDays === null) return { error: 'bad_days' };

  const id = newId('cplv');
  try {
    await query(
      `INSERT INTO campaign_levels (id, campaign_id, views_threshold, reward_days, sort_order)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, campaignId, viewsThreshold, rewardDays, int(raw.sortOrder, 0, 1000) ?? viewsThreshold]);
  } catch (err) {
    if (String(err.code) === '23505') return { error: 'threshold_taken' };
    throw err;
  }
  return { id };
};

export const updateLevel = async (adminId, levelId, raw = {}) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT id, campaign_id FROM campaign_levels WHERE id = $1', [String(levelId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const viewsThreshold = int(raw.viewsThreshold, 1, 1_000_000_000);
  const rewardDays = int(raw.rewardDays, 1, MAX_REWARD_DAYS);
  if (viewsThreshold === null) return { error: 'bad_views' };
  if (rewardDays === null) return { error: 'bad_days' };
  try {
    await query(
      `UPDATE campaign_levels SET views_threshold = $2, reward_days = $3, sort_order = $4 WHERE id = $1`,
      [levelId, viewsThreshold, rewardDays, int(raw.sortOrder, 0, 1000) ?? viewsThreshold]);
  } catch (err) {
    if (String(err.code) === '23505') return { error: 'threshold_taken' };
    throw err;
  }
  return { ok: true };
};

export const setLevelActive = async (adminId, levelId, active) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rowCount } = await query(
    'UPDATE campaign_levels SET active = $2 WHERE id = $1', [String(levelId ?? ''), Boolean(active)]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

export const deleteLevel = async (adminId, levelId) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT (SELECT count(*) FROM campaign_reward_grants WHERE level_id = $1) AS n
       FROM campaign_levels WHERE id = $1`, [String(levelId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (Number(rows[0].n) > 0) return { error: 'has_grants' };
  await query('DELETE FROM campaign_levels WHERE id = $1', [levelId]);
  return { ok: true };
};

/* ─── Администрирование: участники и заявки ───────────────────────────── */

export const listParticipantsForAdmin = async (adminId, campaignId) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT p.*, pr.username, pr.sky_id,
            (SELECT count(*)::int FROM campaign_clicks c WHERE c.participation_id = p.id) AS views
       FROM campaign_participations p JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.campaign_id = $1 ORDER BY p.created_at DESC LIMIT 500`, [String(campaignId ?? '')]);
  return rows.map((r) => ({
    id: r.id, profileId: r.profile_id, username: r.username, skyId: r.sky_id,
    videoUrl: r.video_url, status: r.status, suspiciousReason: r.suspicious_reason,
    views: r.views, createdAt: r.created_at.toISOString(),
  }));
};

export const listRewardGrantsForAdmin = async (adminId, { status, campaignId } = {}) => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const args = [];
  const where = [];
  if (status) { args.push(status); where.push(`g.status = $${args.length}`); }
  if (campaignId) { args.push(campaignId); where.push(`p.campaign_id = $${args.length}`); }
  const { rows } = await query(
    `SELECT g.*, p.profile_id, p.campaign_id, pr.username, pr.sky_id, c.title AS campaign_title,
            l.views_threshold
       FROM campaign_reward_grants g
       JOIN campaign_participations p ON p.id = g.participation_id
       JOIN profiles pr ON pr.id = p.profile_id
       JOIN campaigns c ON c.id = p.campaign_id
       JOIN campaign_levels l ON l.id = g.level_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY g.created_at DESC LIMIT 300`, args);
  return rows.map((r) => ({
    id: r.id, participationId: r.participation_id, profileId: r.profile_id, username: r.username,
    skyId: r.sky_id, campaignId: r.campaign_id, campaignTitle: r.campaign_title,
    viewsThreshold: r.views_threshold, viewsAtRequest: r.views_at_request, rewardDays: r.reward_days,
    status: r.status, ticketId: r.ticket_id, pendingActionId: r.pending_action_id,
    grantedAt: r.granted_at?.toISOString?.() ?? null, createdAt: r.created_at.toISOString(),
  }));
};

export const rejectRewardGrant = async (adminId, grantId, reason = '') => {
  if (!(await can(adminId, 'campaigns'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `UPDATE campaign_reward_grants SET status = 'rejected' WHERE id = $1 AND status = 'pending' RETURNING ticket_id`,
    [String(grantId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const note = text(reason, 500);
  if (rows[0].ticket_id) {
    await replyToTicket(rows[0].ticket_id, adminId,
      note ? `Заявка на награду отклонена: ${note}` : 'Заявка на награду отклонена.');
  }
  return { ok: true };
};

/**
 * Данные для предложения заявки владельцу — вызывается из adminsec.mjs
 * перед оформлением заявки 'campaign_reward'. Не начисляет ничего сама:
 * только проверяет, что заявка существует, ещё не решена и правда
 * принадлежит тому человеку, на кого её собираются оформить.
 */
export const grantForProposal = async (grantId) => {
  const { rows } = await query(
    `SELECT g.*, p.profile_id, l.reward_days AS level_days
       FROM campaign_reward_grants g
       JOIN campaign_participations p ON p.id = g.participation_id
       JOIN campaign_levels l ON l.id = g.level_id
      WHERE g.id = $1`, [String(grantId ?? '')]);
  return rows[0] ?? null;
};

export const markGrantProposed = async (grantId, pendingActionId) => {
  await query(
    `UPDATE campaign_reward_grants SET pending_action_id = $2 WHERE id = $1 AND status = 'pending'`,
    [grantId, pendingActionId]);
};

/**
 * Довести начисление до конца после того, как владелец повернул второй
 * ключ и Prime уже выдан кодом adminsec.mjs (grantPrime). Своего пути к
 * Prime здесь нет — только запись факта и ответ в уже существующий
 * тикет поддержки.
 */
export const finalizeGrant = async (grantId, ownerId, days) => {
  const { rows } = await query(
    `UPDATE campaign_reward_grants SET status = 'granted', granted_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING ticket_id`, [grantId]);
  if (!rows[0]) return { error: 'already_decided' };
  if (rows[0].ticket_id) {
    await replyToTicket(rows[0].ticket_id, ownerId,
      `Начислено ${days} дн. Sky Prime. Заявка ${grantId} закрыта.`);
  }
  return { ok: true, ticketId: rows[0].ticket_id, days };
};

export const failGrant = async (grantId) => {
  await query(`UPDATE campaign_reward_grants SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [grantId]);
};

/**
 * Обложка без строки в базе (обрыв загрузки, смена или удаление
 * мероприятия) занимает место и никогда не откроется: удаление идёт
 * от строки campaigns.has_cover, а строки уже нет.
 */
export const sweepOrphanCampaignCovers = async () => {
  const stored = await listStoredCoverIds();
  if (!stored.length) return 0;

  const { rows } = await query('SELECT id FROM campaigns WHERE has_cover');
  const alive = new Set(rows.map((r) => `ccv-${r.id.slice(5)}`));

  let removed = 0;
  for (const id of stored) {
    if (alive.has(id)) continue;
    await removeCover(id);
    removed += 1;
  }
  return removed;
};
