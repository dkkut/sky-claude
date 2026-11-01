/**
 * Карта друзей: человек сам выбирает, КОМУ из друзей показывать своё местоположение (loc_share), и пока делится — шлёт точки.
 *
 * Принципы:
 *  — по умолчанию не делится никто и ни с кем; включает только сам человек, отдельно для каждого друга;
 *  — делиться можно только с подтверждёнными друзьями (friendships.accepted), решает сервер;
 *  — хранится ОДНА последняя точка (loc_last), истории перемещений нет; «остановить» стирает точку;
 *  — друг видит точку только пока дружба и разрешение действуют; точка старше 24 часов не отдаётся вовсе, старше 10 минут помечена `stale`;
 *  — присланные координаты проверяются (реальная точка, не 0/0), скорость/точность — необязательные числа.
 */
import { query } from './db.mjs';
import { isRealPoint, computeOrdered } from './maps.mjs';
import { featureOn } from './mapsusage.mjs';
import { friendIds } from './friends.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';

const sealPos = (lat, lng) => encryptSecret(JSON.stringify({ lat, lng }));
const openPos = (r) => {
  if (r.pos_enc) { try { const p = JSON.parse(decryptSecret(r.pos_enc)); return isRealPoint(p.lat, p.lng) ? p : null; } catch { return null; } }
  return r.lat != null ? { lat: r.lat, lng: r.lng } : null;
};

const MAX_VIEWERS = 50;
const FRESH_MS = 10 * 60_000;
const DROP_MS = 24 * 3600_000;

export const sharedWith = async (me) => {
  const { rows } = await query('SELECT viewer_id FROM loc_share WHERE owner_id = $1', [me]);
  return rows.map((r) => r.viewer_id);
};

/** Задать полный список тех, кому видно (только из друзей). Остальным доступ закрывается; если список пуст — точка стирается. */
export const setSharing = async (me, viewerIds) => {
  if (!(await featureOn('friends'))) return { error: 'feature_off' };
  const want = [...new Set((Array.isArray(viewerIds) ? viewerIds : []).map(String))].filter((x) => x && x !== me);
  if (want.length > MAX_VIEWERS) return { error: 'too_many' };
  const friends = new Set(await friendIds(me));
  if (want.some((id) => !friends.has(id))) return { error: 'not_friends' };
  await query('DELETE FROM loc_share WHERE owner_id = $1 AND NOT (viewer_id = ANY($2::text[]))', [me, want]);
  for (const v of want) await query('INSERT INTO loc_share (owner_id, viewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, v]);
  if (!want.length) await query('DELETE FROM loc_last WHERE profile_id = $1', [me]);
  return { ok: true, viewers: want };
};

/** Принять точку. Без включённого «делюсь» — отказ (ничего не сохраняем). */
export const putPosition = async (me, input = {}) => {
  if (!(await featureOn('friends'))) return { error: 'feature_off' };
  const lat = Number(input.lat); const lng = Number(input.lng);
  if (!isRealPoint(lat, lng)) return { error: 'bad_point' };
  const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };
  const { rowCount } = await query('SELECT 1 FROM loc_share WHERE owner_id = $1 LIMIT 1', [me]);
  if (!rowCount) return { error: 'not_sharing' };
  await query(
    `INSERT INTO loc_last (profile_id, lat, lng, pos_enc, speed_ms, accuracy_m, updated_at) VALUES ($1,NULL,NULL,$2,$3,$4, now())
     ON CONFLICT (profile_id) DO UPDATE SET lat = NULL, lng = NULL, pos_enc = $2, speed_ms = $3, accuracy_m = $4, updated_at = now()`,
    [me, sealPos(lat, lng), num(input.speed, 100), num(input.accuracy, 100000)]);
  return { ok: true };
};

export const stopSharing = async (me) => {
  await query('DELETE FROM loc_share WHERE owner_id = $1', [me]);
  await query('DELETE FROM loc_last WHERE profile_id = $1', [me]);
  return { ok: true };
};

/** Друзья, которые показывают мне себя: имя, аватар, последняя точка, скорость, время и признак «давно». */
export const visibleFriends = async (me) => {
  if (!(await featureOn('friends'))) return { enabled: false, friends: [] };
  const { rows } = await query(
    `SELECT p.id, p.name, p.username, p.avatar, l.lat, l.lng, l.pos_enc, l.speed_ms, l.accuracy_m, l.updated_at
       FROM loc_share s
       JOIN profiles p ON p.id = s.owner_id
       JOIN friendships f ON f.status = 'accepted' AND f.a_id = LEAST(s.owner_id, s.viewer_id) AND f.b_id = GREATEST(s.owner_id, s.viewer_id)
       LEFT JOIN loc_last l ON l.profile_id = s.owner_id
      WHERE s.viewer_id = $1 AND p.deleted_at IS NULL`, [me]);
  const now = Date.now();
  return {
    enabled: true,
    friends: rows.map((r) => {
      const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      const pos = openPos(r);
      const has = pos != null && now - t < DROP_MS;
      return {
        id: r.id, name: r.name, username: r.username, avatar: r.avatar ?? null,
        point: has ? pos : null,
        speedKmh: has && r.speed_ms != null ? Math.round(r.speed_ms * 3.6) : null,
        accuracyM: has && r.accuracy_m != null ? Math.round(r.accuracy_m) : null,
        updatedAt: has ? new Date(t).toISOString() : null,
        stale: has ? now - t > FRESH_MS : null,
      };
    }),
  };
};

/** Мои друзья (для выбора, кому показывать себя). */
export const myFriends = async (me) => {
  const ids = await friendIds(me);
  if (!ids.length) return [];
  const { rows } = await query('SELECT id, name, username, avatar FROM profiles WHERE id = ANY($1::text[]) AND deleted_at IS NULL ORDER BY name', [ids]);
  return rows.map((r) => ({ id: r.id, name: r.name, username: r.username, avatar: r.avatar ?? null }));
};

const MODES = { car: 'car', foot: 'foot', bike: 'bike' };

/**
 * Маршрут от меня до друга. Точку друга берёт СЕРВЕР из его последнего положения (и только если он разрешил мне и точка не старше 24 часов),
 * поэтому по этой ручке нельзя «пробить» чужие координаты или построить маршрут куда угодно. Нет маршрута — так и отвечаем, прямую линию под видом дороги не рисуем.
 */
export const routeToFriend = async (me, friendId, origin, mode) => {
  if (!(await featureOn('route'))) return { error: 'feature_off' };
  if (!isRealPoint(origin?.lat, origin?.lng)) return { error: 'no_origin' };
  const v = await visibleFriends(me);
  const fr = v.friends.find((x) => x.id === String(friendId));
  if (!fr?.point) return { error: 'friend_not_visible' };
  const r = await computeOrdered({ origin, points: [fr.point], vehicle: MODES[mode] ?? 'car' });
  if (r.error) return r;
  return { ok: true, distanceM: r.distanceM, durationS: r.durationS, polyline: r.polyline, mode: MODES[mode] ?? 'car', friendStale: fr.stale };
};
