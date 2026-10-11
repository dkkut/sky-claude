/**
 * Игровые серверы: серверы, участники, каналы, сообщения.
 *
 * Права решает только этот модуль, по строкам базы: клиент присылает
 * идентификаторы, но не роли и не «я участник». Голосовой канал — это
 * комната войс-пати (voiceparty.mjs), которая заводится при первом входе;
 * сам звук идёт тем же P2P WebRTC, что и в обычных комнатах.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { getRoom, createRoom, liveParticipants } from './voiceparty.mjs';

const MAX_OWNED = 10;
const MAX_MEMBER_OF = 50;
const MAX_CHANNELS = 40;
const MAX_TEXT = 2000;
const PAGE = 50;
const ICONS = ['🎮', '🔫', '🏆', '⚔️', '🎯', '🎲', '🌟', '🔥', '🛡️', '🚀', '👾', '🧩'];

const sid = (p) => `${p}-${crypto.randomUUID()}`;
const cleanName = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanChannel = (s) => String(s ?? '').toLowerCase().trim()
  .replace(/[^a-zа-яё0-9_ -]/gi, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

const isStaff = (role) => role === 'owner' || role === 'moderator';

const roleOf = async (serverId, profileId) => {
  const { rows } = await query(
    'SELECT role FROM game_server_members WHERE server_id = $1 AND profile_id = $2', [serverId, profileId]);
  return rows[0]?.role ?? null;
};

const channelRow = async (channelId) => {
  const { rows } = await query('SELECT * FROM game_channels WHERE id = $1', [channelId]);
  return rows[0] ?? null;
};

export const memberIds = async (serverId) => {
  const { rows } = await query('SELECT profile_id FROM game_server_members WHERE server_id = $1', [serverId]);
  return rows.map((r) => r.profile_id);
};

const serverView = (r, extra = {}) => ({
  id: r.id, name: r.name, icon: r.icon, description: r.description,
  ownerId: r.owner_id, isPublic: r.is_public,
  members: Number(r.members ?? 0), ...extra,
});

/** Мои серверы и открытые для вступления. */
export const listServers = async (me) => {
  const mine = await query(
    `SELECT s.*, (SELECT count(*) FROM game_server_members m WHERE m.server_id = s.id) AS members
       FROM game_servers s JOIN game_server_members me ON me.server_id = s.id AND me.profile_id = $1
      ORDER BY me.joined_at`, [me]);
  const open = await query(
    `SELECT s.*, (SELECT count(*) FROM game_server_members m WHERE m.server_id = s.id) AS members
       FROM game_servers s
      WHERE s.is_public AND NOT EXISTS (SELECT 1 FROM game_server_members m WHERE m.server_id = s.id AND m.profile_id = $1)
        AND NOT EXISTS (SELECT 1 FROM game_server_bans b WHERE b.server_id = s.id AND b.profile_id = $1)
      ORDER BY members DESC, s.created_at DESC LIMIT 50`, [me]);
  return {
    mine: mine.rows.map((r) => serverView(r)),
    open: open.rows.map((r) => serverView(r)),
  };
};

export const createServer = async (me, body) => {
  const name = cleanName(body?.name, 40);
  if (name.length < 2) return { error: 'invalid_name' };
  const icon = ICONS.includes(body?.icon) ? body.icon : '🎮';
  const description = cleanName(body?.description, 200);
  const isPublic = body?.isPublic !== false;

  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM game_servers WHERE owner_id = $1', [me]);
  if (cnt[0].n >= MAX_OWNED) return { error: 'too_many_servers' };

  const id = sid('gsv');
  const invite = crypto.randomBytes(5).toString('hex').toUpperCase();
  const info = sid('gct'); const talk = sid('gct'); const voice = sid('gct');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO game_servers (id, name, icon, description, owner_id, is_public, invite_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, name, icon, description, me, isPublic, invite]);
    await client.query(
      "INSERT INTO game_server_members (server_id, profile_id, role) VALUES ($1,$2,'owner')", [id, me]);
    await client.query(
      `INSERT INTO game_categories (id, server_id, name, position) VALUES
         ($1,$4,'ИНФОРМАЦИЯ',0), ($2,$4,'ОБЩЕНИЕ',1), ($3,$4,'ГОЛОСОВЫЕ',2)`, [info, talk, voice, id]);
    await client.query(
      `INSERT INTO game_channels (id, server_id, category_id, name, type, position) VALUES
         ($1,$5,$2,'правила','announce',0),
         ($3,$5,$4,'общий','text',1),
         ($6,$5,$7,'Лобби','voice',2)`,
      [sid('gch'), info, sid('gch'), talk, id, sid('gch'), voice]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  return { id };
};

/** Полное устройство сервера — только участнику. */
export const getServer = async (me, serverId) => {
  const { rows } = await query(
    `SELECT s.*, (SELECT count(*) FROM game_server_members m WHERE m.server_id = s.id) AS members
       FROM game_servers s WHERE s.id = $1`, [serverId]);
  const s = rows[0];
  if (!s) return { error: 'not_found' };
  const role = await roleOf(serverId, me);
  if (!role) return { error: 'not_member' };

  const [cats, chans, mem] = await Promise.all([
    query('SELECT id, name, position FROM game_categories WHERE server_id = $1 ORDER BY position, id', [serverId]),
    query('SELECT * FROM game_channels WHERE server_id = $1 ORDER BY position, created_at', [serverId]),
    query(
      `SELECT m.profile_id AS id, m.role, p.name, p.username, p.avatar
         FROM game_server_members m JOIN profiles p ON p.id = m.profile_id
        WHERE m.server_id = $1 ORDER BY (m.role = 'owner') DESC, (m.role = 'moderator') DESC, p.name LIMIT 500`,
      [serverId]),
  ]);

  const channels = [];
  for (const c of chans.rows) {
    let voiceMembers = [];
    if (c.type === 'voice' && c.voice_room_id) {
      voiceMembers = (await liveParticipants(c.voice_room_id)).map((p) => ({ id: p.id, name: p.name }));
    }
    channels.push({
      id: c.id, name: c.name, type: c.type, categoryId: c.category_id, position: c.position,
      voiceMembers,
    });
  }
  return {
    server: serverView(s, { myRole: role, inviteCode: isStaff(role) ? s.invite_code : undefined }),
    categories: cats.rows,
    channels,
    members: mem.rows,
  };
};

export const joinServer = async (me, serverId, code) => {
  const { rows } = await query('SELECT * FROM game_servers WHERE id = $1', [serverId]);
  const s = rows[0];
  if (!s) return { error: 'not_found' };
  const byCode = code && String(code).toUpperCase() === s.invite_code;
  if (!s.is_public && !byCode) return { error: 'private_server' };
  const banned = await query('SELECT 1 FROM game_server_bans WHERE server_id = $1 AND profile_id = $2', [serverId, me]);
  if (banned.rows[0]) return { error: 'banned' };
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM game_server_members WHERE profile_id = $1', [me]);
  if (cnt[0].n >= MAX_MEMBER_OF) return { error: 'too_many_servers' };
  const ins = await query(
    "INSERT INTO game_server_members (server_id, profile_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING",
    [serverId, me]);
  return { ok: true, joined: ins.rowCount > 0 };
};

/** Вступить по коду приглашения (закрытые серверы). */
export const joinByCode = async (me, code) => {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]{10}$/.test(c)) return { error: 'bad_code' };
  const { rows } = await query('SELECT id FROM game_servers WHERE invite_code = $1', [c]);
  if (!rows[0]) return { error: 'bad_code' };
  const r = await joinServer(me, rows[0].id, c);
  return r.error ? r : { ...r, serverId: rows[0].id };
};

export const leaveServer = async (me, serverId) => {
  const role = await roleOf(serverId, me);
  if (!role) return { error: 'not_member' };
  if (role === 'owner') return { error: 'owner_cannot_leave' };
  await query('DELETE FROM game_server_members WHERE server_id = $1 AND profile_id = $2', [serverId, me]);
  return { ok: true };
};

export const deleteServer = async (me, serverId) => {
  const role = await roleOf(serverId, me);
  if (role !== 'owner') return { error: role ? 'not_allowed' : 'not_found' };
  const recipients = await memberIds(serverId);
  await query('DELETE FROM game_servers WHERE id = $1', [serverId]);
  return { ok: true, recipients };
};

export const createChannel = async (me, serverId, body) => {
  const role = await roleOf(serverId, me);
  if (!isStaff(role)) return { error: 'not_allowed' };
  const type = ['text', 'voice', 'announce'].includes(body?.type) ? body.type : 'text';
  const name = cleanChannel(body?.name);
  if (name.length < 1) return { error: 'invalid_name' };
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM game_channels WHERE server_id = $1', [serverId]);
  if (cnt[0].n >= MAX_CHANNELS) return { error: 'too_many_channels' };

  let categoryId = String(body?.categoryId ?? '');
  const { rows: cats } = await query('SELECT id, name FROM game_categories WHERE server_id = $1 ORDER BY position', [serverId]);
  if (!cats.some((c) => c.id === categoryId)) {
    const wantVoice = type === 'voice';
    const pick = cats.find((c) => /голос|voice/i.test(c.name) === wantVoice) ?? cats[0];
    if (!pick) return { error: 'no_category' };
    categoryId = pick.id;
  }
  const id = sid('gch');
  await query(
    `INSERT INTO game_channels (id, server_id, category_id, name, type, position)
     VALUES ($1,$2,$3,$4,$5, (SELECT COALESCE(max(position),0)+1 FROM game_channels WHERE server_id = $2))`,
    [id, serverId, categoryId, name, type]);
  return { id };
};

export const deleteChannel = async (me, channelId) => {
  const ch = await channelRow(channelId);
  if (!ch) return { error: 'not_found' };
  if (!isStaff(await roleOf(ch.server_id, me))) return { error: 'not_allowed' };
  if (ch.type !== 'voice') {
    const { rows } = await query(
      "SELECT count(*)::int AS n FROM game_channels WHERE server_id = $1 AND type <> 'voice'", [ch.server_id]);
    if (rows[0].n <= 1) return { error: 'last_text_channel' };
  }
  await query('DELETE FROM game_channels WHERE id = $1', [channelId]);
  return { ok: true, serverId: ch.server_id };
};

const messageView = (r) => ({
  id: r.id, channelId: r.channel_id, authorId: r.author_id,
  authorName: r.name ?? 'Участник', text: r.text, createdAt: r.created_at.toISOString(),
});

export const listMessages = async (me, channelId, before) => {
  const ch = await channelRow(channelId);
  if (!ch) return { error: 'not_found' };
  if (!(await roleOf(ch.server_id, me))) return { error: 'not_member' };
  if (ch.type === 'voice') return { messages: [] };
  const beforeDate = before ? new Date(before) : null;
  const { rows } = await query(
    `SELECT m.*, p.name FROM game_channel_messages m JOIN profiles p ON p.id = m.author_id
      WHERE m.channel_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
      ORDER BY m.created_at DESC LIMIT ${PAGE}`,
    [channelId, beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null]);
  return { messages: rows.reverse().map(messageView), hasMore: rows.length === PAGE };
};

export const postMessage = async (me, channelId, text) => {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) return { error: 'empty' };
  if (body.length > MAX_TEXT) return { error: 'too_long' };
  const ch = await channelRow(channelId);
  if (!ch) return { error: 'not_found' };
  const role = await roleOf(ch.server_id, me);
  if (!role) return { error: 'not_member' };
  if (ch.type === 'voice') return { error: 'voice_channel' };
  if (ch.type === 'announce' && !isStaff(role)) return { error: 'announce_only' };
  const id = sid('gmsg');
  const { rows } = await query(
    `INSERT INTO game_channel_messages (id, channel_id, author_id, text) VALUES ($1,$2,$3,$4)
     RETURNING *, (SELECT name FROM profiles WHERE id = $3) AS name`, [id, channelId, me, body]);
  return { message: messageView(rows[0]), serverId: ch.server_id, recipients: await memberIds(ch.server_id) };
};

export const deleteMessage = async (me, messageId) => {
  const { rows } = await query(
    `SELECT m.id, m.author_id, c.server_id, m.channel_id FROM game_channel_messages m
       JOIN game_channels c ON c.id = m.channel_id WHERE m.id = $1`, [messageId]);
  const m = rows[0];
  if (!m) return { error: 'not_found' };
  const role = await roleOf(m.server_id, me);
  if (!role) return { error: 'not_member' };
  if (m.author_id !== me && !isStaff(role)) return { error: 'not_allowed' };
  await query('DELETE FROM game_channel_messages WHERE id = $1', [messageId]);
  return { ok: true, serverId: m.server_id, channelId: m.channel_id, recipients: await memberIds(m.server_id) };
};

export const kickMember = async (me, serverId, targetId, ban) => {
  const mine = await roleOf(serverId, me);
  if (!isStaff(mine)) return { error: 'not_allowed' };
  const theirs = await roleOf(serverId, targetId);
  if (!theirs) return { error: 'not_found' };
  if (theirs === 'owner' || (theirs === 'moderator' && mine !== 'owner')) return { error: 'not_allowed' };
  await query('DELETE FROM game_server_members WHERE server_id = $1 AND profile_id = $2', [serverId, targetId]);
  if (ban) {
    await query('INSERT INTO game_server_bans (server_id, profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [serverId, targetId]);
  }
  return { ok: true };
};

export const setMemberRole = async (me, serverId, targetId, role) => {
  if ((await roleOf(serverId, me)) !== 'owner') return { error: 'not_allowed' };
  if (!['moderator', 'member'].includes(role)) return { error: 'bad_role' };
  const theirs = await roleOf(serverId, targetId);
  if (!theirs || theirs === 'owner') return { error: 'not_allowed' };
  await query('UPDATE game_server_members SET role = $3 WHERE server_id = $1 AND profile_id = $2', [serverId, targetId, role]);
  return { ok: true };
};

/**
 * Комната для голосового канала. Если живой нет — заводим: строка канала
 * блокируется на время проверки, иначе двое вошедших одновременно
 * создали бы по комнате и оказались бы в разных.
 */
export const voiceRoomFor = async (me, channelId) => {
  const ch = await channelRow(channelId);
  if (!ch) return { error: 'not_found' };
  if (ch.type !== 'voice') return { error: 'not_voice' };
  if (!(await roleOf(ch.server_id, me))) return { error: 'not_member' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT voice_room_id FROM game_channels WHERE id = $1 FOR UPDATE', [channelId]);
    let roomId = rows[0]?.voice_room_id ?? null;
    const live = roomId ? await getRoom(roomId) : null;
    if (!live || live.ended) {
      const title = `Голос: ${ch.name}`.slice(0, 80);
      const made = await createRoom(me, { title, category: 'gaming', isPrivate: true, maxParticipants: 25 });
      if (made.error) { await client.query('ROLLBACK'); return { error: made.error }; }
      roomId = made.room.id;
      await client.query('UPDATE game_channels SET voice_room_id = $2 WHERE id = $1', [channelId, roomId]);
    }
    await client.query('COMMIT');
    return { roomId, serverId: ch.server_id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
};
