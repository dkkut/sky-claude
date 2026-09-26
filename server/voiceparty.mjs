/**
 * Войс-пати: голосовые комнаты.
 *
 * Метаданные комнаты (кто завёл, название, лимит, права) и бан-лист —
 * в базе, чтобы пережить перезапуск и быть видимыми всем. Кто прямо
 * сейчас в комнате — живое состояние в памяти хаба (server/signal.mjs
 * импортирует этот модуль и держит его вместе с уже существующей
 * картой online-соединений): роль/мьют/поднятая рука меняются много
 * раз в секунду, и писать это на диск при каждом действии незачем —
 * то же самое решение, что уже применено к очереди online-пользователей.
 *
 * Сам голос (WebRTC offer/answer/ICE) по-прежнему идёт через
 * src/calls/webrtc.ts и общий case 'call-offer'/... в signal.mjs —
 * этот модуль только определяет, разрешено ли двоим сейчас созваниваться
 * (bothInRoom) и кому разослать live-обновления комнаты (memberIds).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';

const newId = () => `vp-${crypto.randomUUID()}`;

/** roomId -> Map<profileId, { role, muted, handRaised, joinedAt }> */
const members = new Map();

const roomOf = (roomId) => members.get(roomId) ?? null;
export const memberIds = (roomId) => [...(roomOf(roomId)?.keys() ?? [])];
export const isMember = (roomId, profileId) => roomOf(roomId)?.has(profileId) ?? false;
export const bothInRoom = (roomId, a, b) => isMember(roomId, a) && isMember(roomId, b);

/** callId === `vp:${roomId}:${pair}` — вытаскиваем roomId для проверки прав на звонок. */
export const roomIdFromCallId = (callId) => {
  const m = /^vp:([^:]+):/.exec(String(callId ?? ''));
  return m ? m[1] : null;
};

const profilesById = async (ids) => {
  if (!ids.length) return new Map();
  const { rows } = await query('SELECT id, name, username, avatar FROM profiles WHERE id = ANY($1)', [ids]);
  return new Map(rows.map((r) => [r.id, r]));
};

/** Живой список участников с именами — для тех, кто сейчас в комнате. */
export const liveParticipants = async (roomId) => {
  const map = roomOf(roomId);
  if (!map || map.size === 0) return [];
  const profiles = await profilesById([...map.keys()]);
  return [...map.entries()].map(([id, st]) => {
    const p = profiles.get(id);
    return {
      id, name: p?.name ?? 'Участник', username: p?.username, avatar: p?.avatar ?? null,
      role: st.role, muted: st.muted, handRaised: st.handRaised, joinedAt: st.joinedAt,
    };
  });
};

const toRoomView = async (row) => ({
  id: row.id, title: row.title, description: row.description, category: row.category,
  ownerId: row.owner_id, isPrivate: row.is_private, inviteCode: row.invite_code,
  maxParticipants: row.max_participants, permissions: row.permissions,
  createdAt: row.created_at, scheduledFor: row.scheduled_for, ended: row.ended_at != null,
  participants: await liveParticipants(row.id),
});

/** Только для владельца/модераторов — кто забанен в этой комнате. */
export const bannedIds = async (roomId) => {
  const { rows } = await query('SELECT profile_id FROM voice_room_bans WHERE room_id = $1', [roomId]);
  return rows.map((b) => b.profile_id);
};

export const createRoom = async (ownerId, input = {}) => {
  const title = String(input.title ?? '').trim().slice(0, 80);
  if (title.length < 2) return { error: 'invalid_title' };
  const description = String(input.description ?? '').trim().slice(0, 300);
  const category = ['interests', 'gaming', 'study', 'music', 'business', 'public'].includes(input.category)
    ? input.category : 'interests';
  const isPrivate = Boolean(input.isPrivate);
  const maxParticipants = Math.min(50, Math.max(2, Number(input.maxParticipants) || 25));
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (scheduledFor && (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now())) {
    return { error: 'invalid_schedule' };
  }
  const id = newId();
  const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const { rows } = await query(
    `INSERT INTO voice_rooms (id, title, description, category, owner_id, is_private, invite_code, max_participants, scheduled_for)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, title, description, category, ownerId, isPrivate, inviteCode, maxParticipants, scheduledFor],
  );
  return { room: await toRoomView(rows[0]) };
};

export const deleteRoom = async (ownerId, roomId) => {
  const { rows } = await query('SELECT owner_id FROM voice_rooms WHERE id = $1 AND ended_at IS NULL', [roomId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };
  await query('UPDATE voice_rooms SET ended_at = now() WHERE id = $1', [roomId]);
  members.delete(roomId);
  return { ok: true };
};

/** Комната закончилась сама, когда из неё вышел последний человек —
 *  но только если она не была запланирована на будущее заранее: у
 *  запланированной комнаты пустота до начала — нормальное состояние. */
const endIfEmpty = async (roomId) => {
  const map = roomOf(roomId);
  if (map && map.size > 0) return;
  members.delete(roomId);
  await query(
    `UPDATE voice_rooms SET ended_at = now()
      WHERE id = $1 AND ended_at IS NULL AND (scheduled_for IS NULL OR scheduled_for <= now())`,
    [roomId],
  );
};

export const listRooms = async () => {
  const { rows } = await query(
    `SELECT * FROM voice_rooms WHERE ended_at IS NULL AND is_private = false
      ORDER BY created_at DESC LIMIT 200`,
  );
  const views = await Promise.all(rows.map(toRoomView));
  return {
    live: views.filter((r) => !r.scheduledFor),
    scheduled: views.filter((r) => r.scheduledFor),
  };
};

export const getRoom = async (roomId) => {
  const { rows } = await query('SELECT * FROM voice_rooms WHERE id = $1', [roomId]);
  if (!rows[0]) return null;
  return toRoomView(rows[0]);
};

export const isBanned = async (roomId, profileId) => {
  const { rows } = await query(
    'SELECT 1 FROM voice_room_bans WHERE room_id = $1 AND profile_id = $2', [roomId, profileId],
  );
  return rows.length > 0;
};

/** Встать в комнату. Возвращает {room, participants, myRole} или {error}. */
export const joinRoom = async (profileId, roomId) => {
  const roomRow = (await query('SELECT * FROM voice_rooms WHERE id = $1', [roomId])).rows[0];
  if (!roomRow || roomRow.ended_at) return { error: 'not_found' };
  if (await isBanned(roomId, profileId)) return { error: 'banned' };

  let map = roomOf(roomId);
  if (!map) { map = new Map(); members.set(roomId, map); }
  if (!map.has(profileId)) {
    if (map.size >= roomRow.max_participants) return { error: 'room_full' };
    const isOwner = roomRow.owner_id === profileId;
    const requireApproval = roomRow.permissions?.requireApprovalToSpeak && !isOwner;
    const role = isOwner ? 'owner' : (requireApproval ? 'listener' : 'speaker');
    map.set(profileId, { role, muted: false, handRaised: false, joinedAt: new Date().toISOString() });
  }

  const participants = await liveParticipants(roomId);
  const room = { ...(await toRoomView(roomRow)), participants };
  return { room, participants, myRole: map.get(profileId).role };
};

export const leaveRoom = async (profileId, roomId) => {
  const map = roomOf(roomId);
  if (!map?.has(profileId)) return;
  map.delete(profileId);
  await endIfEmpty(roomId);
};

/** Убрать человека из ВСЕХ комнат сразу — вызывается при полном оффлайне. */
export const leaveAllRooms = async (profileId) => {
  const left = [];
  for (const [roomId, map] of members) {
    if (map.has(profileId)) { map.delete(profileId); left.push(roomId); }
  }
  await Promise.all(left.map(endIfEmpty));
  return left;
};

const MOD_ROLES = new Set(['owner', 'admin', 'moderator']);
export const canModerate = (roomId, profileId) => MOD_ROLES.has(roomOf(roomId)?.get(profileId)?.role);
export const isOwner = async (roomId, profileId) => {
  const map = roomOf(roomId);
  if (map?.get(profileId)?.role === 'owner') return true;
  const row = (await query('SELECT owner_id FROM voice_rooms WHERE id = $1', [roomId])).rows[0];
  return row?.owner_id === profileId;
};

export const setMuted = (roomId, profileId, muted) => {
  const st = roomOf(roomId)?.get(profileId);
  if (!st) return false;
  st.muted = Boolean(muted);
  return true;
};
export const setHandRaised = (roomId, profileId, raised) => {
  const st = roomOf(roomId)?.get(profileId);
  if (!st) return false;
  st.handRaised = Boolean(raised);
  return true;
};
export const setRole = (roomId, targetId, role) => {
  if (!['admin', 'moderator', 'speaker', 'listener'].includes(role)) return false; // 'owner' не переназначается
  const st = roomOf(roomId)?.get(targetId);
  if (!st || st.role === 'owner') return false;
  st.role = role;
  if (role !== 'speaker') st.handRaised = false;
  return true;
};
export const kick = (roomId, targetId) => {
  const map = roomOf(roomId);
  if (!map?.has(targetId)) return false;
  map.delete(targetId);
  void endIfEmpty(roomId);
  return true;
};
export const ban = async (roomId, targetId) => {
  kick(roomId, targetId);
  await query(
    'INSERT INTO voice_room_bans (room_id, profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [roomId, targetId],
  );
  return true;
};
export const updatePermissions = async (roomId, patch) => {
  const row = (await query('SELECT permissions FROM voice_rooms WHERE id = $1', [roomId])).rows[0];
  if (!row) return null;
  const next = { ...row.permissions, ...patch };
  await query('UPDATE voice_rooms SET permissions = $2::jsonb WHERE id = $1', [roomId, JSON.stringify(next)]);
  return next;
};
