/**
 * Управление группами и каналами: роли, права, настройки, приглашения,
 * заявки и исключения.
 *
 * Главное правило: право проверяется здесь, на сервере, и выводится из
 * роли в базе. Интерфейс роли только рисует — присланная клиентом роль
 * не значит ничего.
 *
 * Разница между группой и каналом заложена в тип чата, а не в галочку:
 * в канале писать могут только владелец и админы, и это нельзя
 * переключить настройкой. Иначе «канал» был бы просто группой с другим
 * названием — как оно и было до сих пор.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';

/* ─── Роли и права ─────────────────────────────────────────────────────── */

export const ROLES = ['owner', 'admin', 'moderator', 'helper', 'member'];

/** Кто кого может назначать: роль не выше собственной. */
const RANK = { owner: 4, admin: 3, moderator: 2, helper: 1, member: 0 };

/**
 * Что позволено роли. Набор повторяет тот, что показывает интерфейс, но
 * решение принимается по этой таблице, а не по той.
 */
const PERMISSIONS = {
  owner:     { changeInfo: true,  pin: true,  deleteOthers: true,  restrict: true,  ban: true,  invite: true,  manageRoles: true,  approveJoins: true,  post: true },
  admin:     { changeInfo: true,  pin: true,  deleteOthers: true,  restrict: true,  ban: true,  invite: true,  manageRoles: true,  approveJoins: true,  post: true },
  moderator: { changeInfo: false, pin: true,  deleteOthers: true,  restrict: true,  ban: true,  invite: true,  manageRoles: false, approveJoins: true,  post: true },
  helper:    { changeInfo: false, pin: true,  deleteOthers: false, restrict: false, ban: false, invite: true,  manageRoles: false, approveJoins: false, post: true },
  member:    { changeInfo: false, pin: false, deleteOthers: false, restrict: false, ban: false, invite: false, manageRoles: false, approveJoins: false, post: true },
};

export const permissionsOf = (role) => PERMISSIONS[role] ?? PERMISSIONS.member;

/** Роль человека в чате. null — он не участник. */
export const roleOf = async (chatId, userId) => {
  const { rows } = await query(
    'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId],
  );
  return rows[0]?.role ?? null;
};

/** Тип чата и его владелец — нужны почти каждой проверке. */
const chatInfo = async (chatId) => {
  const { rows } = await query('SELECT type, owner_id FROM chats WHERE id = $1', [chatId]);
  return rows[0] ?? null;
};

/**
 * Роль вместе с правами и типом чата. Возвращает null, если человек не
 * участник: тогда любая операция для него закрыта.
 */
export const contextFor = async (chatId, userId) => {
  const chat = await chatInfo(chatId);
  if (!chat) return null;
  const role = await roleOf(chatId, userId);
  if (!role) return null;
  return { type: chat.type, ownerId: chat.owner_id, role, can: permissionsOf(role) };
};

/* ─── Настройки ────────────────────────────────────────────────────────── */

const DEFAULTS = {
  whoCanPost: 'all',
  welcomeEnabled: false,
  welcomeMessage: '',
  requireApproval: false,
  joinQuestion: '',
  antiFlood: true,
  antiFloodPerMin: 20,
  antiSpamLinks: false,
  slowModeSec: 0,
};

const toSettings = (row, type) => {
  if (!row) return { ...DEFAULTS, whoCanPost: type === 'channel' ? 'admins' : 'all' };
  return {
    // В канале право писать не настраивается: оно и делает его каналом.
    whoCanPost:      type === 'channel' ? 'admins' : row.who_can_post,
    welcomeEnabled:  row.welcome_enabled,
    welcomeMessage:  decryptContent(row.welcome_message) ?? '',
    requireApproval: row.require_approval,
    joinQuestion:    decryptContent(row.join_question) ?? '',
    antiFlood:       row.anti_flood,
    antiFloodPerMin: row.anti_flood_per_min,
    antiSpamLinks:   row.anti_spam_links,
    slowModeSec:     row.slow_mode_sec,
  };
};

export const getSettings = async (chatId) => {
  const chat = await chatInfo(chatId);
  if (!chat || chat.type === 'direct') return null;
  const { rows } = await query('SELECT * FROM chat_settings WHERE chat_id = $1', [chatId]);
  return toSettings(rows[0], chat.type);
};

/** Числовое поле в допустимых пределах — клиент присылает что угодно. */
const clampInt = (value, min, max, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

export const updateSettings = async (chatId, actorId, patch) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  if (ctx.type === 'direct') return { error: 'not_allowed' };
  if (!ctx.can.changeInfo) return { error: 'not_allowed' };

  const current = await getSettings(chatId);
  const next = {
    // Право писать в канале не меняется настройкой — только тип чата.
    // В группе поле, которого нет в изменении, остаётся прежним: иначе
    // правка галочки антифлуда молча открывала бы запись всем.
    whoCanPost: ctx.type === 'channel' ? 'admins'
      : patch.whoCanPost === undefined ? current.whoCanPost
      : (patch.whoCanPost === 'admins' ? 'admins' : 'all'),
    welcomeEnabled:  patch.welcomeEnabled === undefined ? current.welcomeEnabled : Boolean(patch.welcomeEnabled),
    welcomeMessage:  String(patch.welcomeMessage ?? current.welcomeMessage).slice(0, 500),
    requireApproval: patch.requireApproval === undefined ? current.requireApproval : Boolean(patch.requireApproval),
    joinQuestion:    String(patch.joinQuestion ?? current.joinQuestion).slice(0, 200),
    antiFlood:       patch.antiFlood === undefined ? current.antiFlood : Boolean(patch.antiFlood),
    antiFloodPerMin: clampInt(patch.antiFloodPerMin ?? current.antiFloodPerMin, 1, 240, 20),
    antiSpamLinks:   patch.antiSpamLinks === undefined ? current.antiSpamLinks : Boolean(patch.antiSpamLinks),
    slowModeSec:     clampInt(patch.slowModeSec ?? current.slowModeSec, 0, 3600, 0),
  };

  await query(
    `INSERT INTO chat_settings
       (chat_id, who_can_post, welcome_enabled, welcome_message, require_approval,
        join_question, anti_flood, anti_flood_per_min, anti_spam_links, slow_mode_sec, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (chat_id) DO UPDATE SET
       who_can_post = $2, welcome_enabled = $3, welcome_message = $4, require_approval = $5,
       join_question = $6, anti_flood = $7, anti_flood_per_min = $8, anti_spam_links = $9,
       slow_mode_sec = $10, updated_at = now()`,
    [chatId, next.whoCanPost, next.welcomeEnabled, encryptContent(next.welcomeMessage),
     next.requireApproval, encryptContent(next.joinQuestion), next.antiFlood,
     next.antiFloodPerMin, next.antiSpamLinks, next.slowModeSec],
  );
  await writeLog(chatId, actorId, null, 'settings_change', 'Настройки чата изменены');
  return { settings: next };
};

/* ─── Журнал ───────────────────────────────────────────────────────────── */

export const writeLog = async (chatId, actorId, targetId, type, detail) => {
  await query(
    `INSERT INTO chat_log (id, chat_id, actor_id, target_id, type, detail)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [`lg-${crypto.randomUUID()}`, chatId, actorId, targetId ?? null,
     String(type).slice(0, 40), encryptContent(String(detail ?? '').slice(0, 300))],
  );
};

export const listLog = async (chatId, actorId, limit = 100) => {
  const ctx = await contextFor(chatId, actorId);
  // Журнал — для тех, кто управляет чатом, а не для всех подряд.
  // В личном чате управлять нечем: там оба равны, и создатель значится
  // владельцем только потому, что кто-то должен был чат завести.
  if (!ctx || ctx.type === 'direct' || !ctx.can.restrict) return null;
  const { rows } = await query(
    `SELECT id, actor_id, target_id, type, detail, created_at FROM chat_log
      WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [chatId, Math.min(Math.max(Number(limit) || 100, 1), 300)],
  );
  return rows.map((r) => ({
    id: r.id, actorId: r.actor_id, targetId: r.target_id ?? undefined,
    type: r.type, detail: decryptContent(r.detail) ?? '',
    createdAt: r.created_at.toISOString(),
  }));
};

/* ─── Роли участников ──────────────────────────────────────────────────── */

export const setRole = async (chatId, actorId, userId, role) => {
  if (!ROLES.includes(role) || role === 'owner') return { error: 'not_allowed' };
  if (actorId === userId) return { error: 'not_allowed' };

  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  if (ctx.type === 'direct') return { error: 'not_allowed' };
  if (!ctx.can.manageRoles) return { error: 'not_allowed' };

  const targetRole = await roleOf(chatId, userId);
  if (!targetRole) return { error: 'not_found' };
  // Владельца не разжаловать, и роль выше собственной не назначить и не
  // снять: иначе админ повышал бы себя чужими руками.
  if (targetRole === 'owner') return { error: 'not_allowed' };
  if (RANK[targetRole] >= RANK[ctx.role] || RANK[role] >= RANK[ctx.role]) {
    return { error: 'not_allowed' };
  }

  await query('UPDATE chat_members SET role = $3 WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId, role]);
  await writeLog(chatId, actorId, userId, 'role_change', `Роль изменена на ${role}`);
  return { ok: true };
};

/* ─── Исключение и ограничения ─────────────────────────────────────────── */

const canActOn = async (chatId, ctx, userId) => {
  const targetRole = await roleOf(chatId, userId);
  if (!targetRole) return false;
  if (targetRole === 'owner') return false;
  return RANK[targetRole] < RANK[ctx.role];
};

export const kickMember = async (chatId, actorId, userId, { ban = false } = {}) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  if (ctx.type === 'direct') return { error: 'not_allowed' };
  if (ban ? !ctx.can.ban : !ctx.can.restrict) return { error: 'not_allowed' };
  if (actorId === userId) return { error: 'not_allowed' };
  if (!(await canActOn(chatId, ctx, userId))) return { error: 'not_allowed' };

  const members = await memberList(chatId);
  await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
  if (ban) {
    await query(
      `INSERT INTO chat_bans (chat_id, user_id, by_id) VALUES ($1,$2,$3)
       ON CONFLICT (chat_id, user_id) DO UPDATE SET by_id = $3, created_at = now()`,
      [chatId, userId, actorId],
    );
  }
  await writeLog(chatId, actorId, userId, ban ? 'ban' : 'kick',
    ban ? 'Участник заблокирован' : 'Участник исключён');
  return { ok: true, members };
};

export const unbanMember = async (chatId, actorId, userId) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  // В личном чате блокировок нет — иначе туда попадали бы записи
  // журнала о снятии того, чего не было.
  if (ctx.type === 'direct') return { error: 'not_allowed' };
  if (!ctx.can.ban) return { error: 'not_allowed' };
  await query('DELETE FROM chat_bans WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
  await writeLog(chatId, actorId, userId, 'unban', 'Блокировка снята');
  return { ok: true };
};

export const muteMember = async (chatId, actorId, userId, minutes) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  if (ctx.type === 'direct') return { error: 'not_allowed' };
  if (!ctx.can.restrict) return { error: 'not_allowed' };
  if (!(await canActOn(chatId, ctx, userId))) return { error: 'not_allowed' };

  const mins = clampInt(minutes, 0, 60 * 24 * 365, 60);
  await query(
    `UPDATE chat_members SET muted_until = CASE WHEN $3 = 0 THEN NULL
                                                ELSE now() + ($3 || ' minutes')::interval END
      WHERE chat_id = $1 AND user_id = $2`,
    [chatId, userId, String(mins)],
  );
  await writeLog(chatId, actorId, userId, mins === 0 ? 'unmute' : 'mute',
    mins === 0 ? 'Ограничение снято' : `Нельзя писать ${mins} мин.`);
  return { ok: true };
};

export const isBanned = async (chatId, userId) => {
  const { rowCount } = await query(
    `SELECT 1 FROM chat_bans
      WHERE chat_id = $1 AND user_id = $2 AND (until IS NULL OR until > now())`,
    [chatId, userId],
  );
  return rowCount > 0;
};

const memberList = async (chatId) => {
  const { rows } = await query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId]);
  return rows.map((r) => r.user_id);
};

/* ─── Приглашения ──────────────────────────────────────────────────────── */

/**
 * Ссылка-приглашение — единственный способ впустить в группу человека,
 * с которым у зовущего ещё нет общего чата. Приглашение выдаёт тот, у
 * кого есть на это право, а войти по нему человек решает сам: так его
 * не затаскивают в чат без спроса.
 */
export const createInvite = async (chatId, actorId, { maxUses, expiresInHours } = {}) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  if (ctx.type === 'direct') return { error: 'not_allowed' };
  if (!ctx.can.invite) return { error: 'not_allowed' };

  const { rows: many } = await query(
    `SELECT count(*)::int AS n FROM chat_invites
      WHERE chat_id = $1 AND NOT revoked
        AND (expires_at IS NULL OR expires_at > now())`,
    [chatId],
  );
  if ((many[0]?.n ?? 0) >= 20) return { error: 'too_many_invites' };

  const code = crypto.randomBytes(18).toString('base64url');
  const uses = maxUses === undefined || maxUses === null ? null : clampInt(maxUses, 1, 10000, 1);
  const hours = expiresInHours === undefined || expiresInHours === null
    ? null : clampInt(expiresInHours, 1, 24 * 365, 24);

  await query(
    `INSERT INTO chat_invites (code, chat_id, created_by, max_uses, expires_at)
     VALUES ($1,$2,$3,$4, CASE WHEN $5::text IS NULL THEN NULL
                               ELSE now() + ($5 || ' hours')::interval END)`,
    [code, chatId, actorId, uses, hours === null ? null : String(hours)],
  );
  await writeLog(chatId, actorId, null, 'invite_created', 'Создана ссылка-приглашение');
  return { invite: { code, chatId, maxUses: uses, uses: 0, expiresInHours: hours } };
};

export const revokeInvite = async (code, actorId) => {
  const { rows } = await query('SELECT chat_id FROM chat_invites WHERE code = $1', [String(code ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const ctx = await contextFor(rows[0].chat_id, actorId);
  if (!ctx || !ctx.can.invite) return { error: 'not_allowed' };
  await query('UPDATE chat_invites SET revoked = TRUE WHERE code = $1', [code]);
  await writeLog(rows[0].chat_id, actorId, null, 'invite_revoked', 'Ссылка отозвана');
  return { ok: true, chatId: rows[0].chat_id };
};

export const listInvites = async (chatId, actorId) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx || !ctx.can.invite) return null;
  const { rows } = await query(
    `SELECT code, created_by, max_uses, uses, revoked, expires_at, created_at
       FROM chat_invites WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [chatId],
  );
  return rows.map((r) => ({
    code: r.code, createdBy: r.created_by, maxUses: r.max_uses ?? undefined,
    uses: r.uses, revoked: r.revoked,
    expiresAt: r.expires_at ? r.expires_at.toISOString() : undefined,
    createdAt: r.created_at.toISOString(),
  }));
};

/**
 * Вход по ссылке.
 *
 * Счётчик использований увеличивается под блокировкой строки: без неё
 * ссылка «на один вход» пропускала бы всех, кто нажал одновременно.
 */
export const joinByInvite = async (code, userId, answer = '') => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT i.chat_id, i.max_uses, i.uses, i.revoked, i.expires_at, c.type
         FROM chat_invites i JOIN chats c ON c.id = i.chat_id
        WHERE i.code = $1 FOR UPDATE OF i`,
      [String(code ?? '')],
    );
    const inv = rows[0];
    if (!inv || inv.revoked
        || (inv.expires_at && inv.expires_at <= new Date())
        || (inv.max_uses !== null && inv.uses >= inv.max_uses)) {
      await client.query('ROLLBACK');
      return { error: 'invalid_invite' };
    }

    const { rowCount: trashed } = await client.query('SELECT 1 FROM chats WHERE id = $1 AND trashed_at IS NOT NULL', [inv.chat_id]);
    if (trashed) { await client.query('ROLLBACK'); return { error: 'invalid_invite' }; }

    const { rowCount: banned } = await client.query(
      `SELECT 1 FROM chat_bans WHERE chat_id = $1 AND user_id = $2
        AND (until IS NULL OR until > now())`,
      [inv.chat_id, userId],
    );
    if (banned) { await client.query('ROLLBACK'); return { error: 'banned' }; }

    const { rowCount: already } = await client.query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [inv.chat_id, userId],
    );
    if (already) { await client.query('COMMIT'); return { chatId: inv.chat_id, joined: true }; }

    const { rows: full } = await client.query(
      'SELECT count(*)::int AS n FROM chat_members WHERE chat_id = $1', [inv.chat_id],
    );
    if ((full[0]?.n ?? 0) >= 100) { await client.query('ROLLBACK'); return { error: 'chat_full' }; }

    const { rows: cfg } = await client.query(
      'SELECT require_approval FROM chat_settings WHERE chat_id = $1', [inv.chat_id],
    );
    if (cfg[0]?.require_approval) {
      await client.query(
        `INSERT INTO chat_join_requests (chat_id, user_id, answer) VALUES ($1,$2,$3)
         ON CONFLICT (chat_id, user_id) DO UPDATE SET answer = $3, status = 'pending', created_at = now()`,
        [inv.chat_id, userId, encryptContent(String(answer ?? '').slice(0, 300))],
      );
      await client.query('UPDATE chat_invites SET uses = uses + 1 WHERE code = $1', [code]);
      await client.query('COMMIT');
      return { chatId: inv.chat_id, pending: true };
    }

    await client.query(
      'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [inv.chat_id, userId],
    );
    await client.query('UPDATE chat_invites SET uses = uses + 1 WHERE code = $1', [code]);
    await client.query('COMMIT');
    return { chatId: inv.chat_id, joined: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Заявки ───────────────────────────────────────────────────────────── */

export const listJoinRequests = async (chatId, actorId) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx || !ctx.can.approveJoins) return null;
  const { rows } = await query(
    `SELECT user_id, answer, created_at FROM chat_join_requests
      WHERE chat_id = $1 AND status = 'pending' ORDER BY created_at LIMIT 200`,
    [chatId],
  );
  return rows.map((r) => ({
    userId: r.user_id, answer: decryptContent(r.answer) ?? '',
    createdAt: r.created_at.toISOString(),
  }));
};

export const decideJoin = async (chatId, actorId, userId, approve) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  if (!ctx.can.approveJoins) return { error: 'not_allowed' };

  // Предел на размер чата проверяется ДО отметки «одобрено»: иначе
  // заявка осталась бы одобренной, а человек — не в чате, и подать её
  // заново он бы уже не смог.
  if (approve) {
    const { rows: full } = await query(
      'SELECT count(*)::int AS n FROM chat_members WHERE chat_id = $1', [chatId],
    );
    if ((full[0]?.n ?? 0) >= 100) return { error: 'chat_full' };
  }

  const { rowCount } = await query(
    `UPDATE chat_join_requests SET status = $3
      WHERE chat_id = $1 AND user_id = $2 AND status = 'pending'`,
    [chatId, userId, approve ? 'approved' : 'rejected'],
  );
  if (!rowCount) return { error: 'not_found' };

  if (approve) {
    await query(
      'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [chatId, userId],
    );
  }
  await writeLog(chatId, actorId, userId, approve ? 'join_approved' : 'join_rejected',
    approve ? 'Заявка одобрена' : 'Заявка отклонена');
  return { ok: true, joined: approve, members: await memberList(chatId) };
};

/* ─── Право написать ───────────────────────────────────────────────────── */

/**
 * Может ли человек прямо сейчас написать в этот чат.
 *
 * Здесь собраны все причины, по которым сообщение не должно сохраниться:
 * канал без прав, включённый «только админы», ограничение участника,
 * антифлуд, медленный режим и запрет ссылок. Проверка одна на всех —
 * иначе какое-нибудь правило рано или поздно забыли бы в одной из веток.
 *
 * Возвращает null, если писать можно, иначе короткую причину.
 */
export const postDenial = async (chatId, userId, text) => {
  const chat = await chatInfo(chatId);
  if (!chat || chat.type === 'direct') return null;

  const { rows } = await query(
    `SELECT m.role, m.muted_until, s.who_can_post, s.anti_flood, s.anti_flood_per_min,
            s.anti_spam_links, s.slow_mode_sec
       FROM chat_members m
       LEFT JOIN chat_settings s ON s.chat_id = m.chat_id
      WHERE m.chat_id = $1 AND m.user_id = $2`,
    [chatId, userId],
  );
  const row = rows[0];
  if (!row) return 'not_member';

  const isStaff = row.role !== 'member';

  // Канал — это вещание: пишут только те, кто им управляет, и настройкой
  // это не меняется.
  const whoCanPost = chat.type === 'channel' ? 'admins' : (row.who_can_post ?? 'all');
  const RUNS_CHAT = new Set(['owner', 'admin', 'moderator']);
  if (whoCanPost === 'admins' && !RUNS_CHAT.has(row.role)) {
    return chat.type === 'channel' ? 'channel_readonly' : 'admins_only';
  }

  if (row.muted_until && row.muted_until > new Date()) return 'muted';

  if (!isStaff && row.anti_spam_links && /https?:\/\/\S+/i.test(String(text ?? ''))) {
    return 'links_not_allowed';
  }

  if (!isStaff && row.slow_mode_sec > 0) {
    const { rows: last } = await query(
      `SELECT created_at FROM messages
        WHERE chat_id = $1 AND author_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [chatId, userId],
    );
    if (last[0] && Date.now() - last[0].created_at.getTime() < row.slow_mode_sec * 1000) {
      return 'slow_mode';
    }
  }

  if (!isStaff && row.anti_flood) {
    const { rows: recent } = await query(
      `SELECT count(*)::int AS n FROM messages
        WHERE chat_id = $1 AND author_id = $2 AND created_at > now() - interval '1 minute'`,
      [chatId, userId],
    );
    if ((recent[0]?.n ?? 0) >= (row.anti_flood_per_min ?? 20)) return 'flood';
  }

  return null;
};

/* ─── Просмотры записей канала ─────────────────────────────────────────── */

/**
 * Отмечает записи прочитанными и возвращает обновлённые счётчики.
 * Считаются уникальные читатели: повторное открытие ничего не добавляет.
 */
export const markViewed = async (chatId, userId, messageIds) => {
  const ids = (Array.isArray(messageIds) ? messageIds : []).map(String).slice(0, 200);
  if (ids.length === 0) return null;

  const { rowCount } = await query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId],
  );
  if (!rowCount) return null;

  await query(
    `INSERT INTO message_views (message_id, user_id)
     SELECT m.id, $2 FROM messages m
      WHERE m.chat_id = $1 AND m.id = ANY($3::text[])
     ON CONFLICT DO NOTHING`,
    [chatId, userId, ids],
  );

  // Считаем только по записям ЭТОГО чата. Без условия по chat_id
  // подписчик одного канала мог бы прислать идентификаторы записей
  // другого и узнать их охват, не будучи там подписан.
  const { rows } = await query(
    `SELECT v.message_id, count(*)::int AS n
       FROM message_views v JOIN messages m ON m.id = v.message_id
      WHERE m.chat_id = $1 AND v.message_id = ANY($2::text[])
      GROUP BY v.message_id`,
    [chatId, ids],
  );
  return rows.map((r) => ({ messageId: r.message_id, views: r.n }));
};

/* ─── Закрепление ──────────────────────────────────────────────────────── */

export const pinMessage = async (chatId, actorId, messageId, pin) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return { error: 'not_found' };
  // В личном чате закрепляет каждый из двоих; в группе — по праву.
  if (ctx.type !== 'direct' && !ctx.can.pin) return { error: 'not_allowed' };

  const { rowCount } = await query(
    `UPDATE messages SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END,
                         pinned_by = CASE WHEN $3 THEN $4 ELSE NULL END
      WHERE id = $1 AND chat_id = $2 AND NOT deleted`,
    [String(messageId ?? ''), chatId, Boolean(pin), actorId],
  );
  if (!rowCount) return { error: 'not_found' };
  return { ok: true, messageId: String(messageId), pinned: Boolean(pin) };
};

/* ─── Состав чата для управления ───────────────────────────────────────── */

export const listMembers = async (chatId, actorId) => {
  const ctx = await contextFor(chatId, actorId);
  if (!ctx) return null;
  // В канале список подписчиков виден только тем, кто им управляет:
  // иначе любой читатель получал бы полный список аудитории.
  if (ctx.type === 'channel' && !ctx.can.restrict) return { hidden: true, count: await memberCount(chatId) };

  const { rows } = await query(
    `SELECT m.user_id, m.role, m.muted_until, p.name, p.username
       FROM chat_members m JOIN profiles p ON p.id = m.user_id
      WHERE m.chat_id = $1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
                           WHEN 'moderator' THEN 2 WHEN 'helper' THEN 3 ELSE 4 END,
               p.name`,
    [chatId],
  );
  return {
    members: rows.map((r) => ({
      id: r.user_id, role: r.role, name: r.name, username: r.username,
      mutedUntil: r.muted_until ? r.muted_until.toISOString() : undefined,
    })),
  };
};

const memberCount = async (chatId) => {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM chat_members WHERE chat_id = $1', [chatId],
  );
  return rows[0]?.n ?? 0;
};
