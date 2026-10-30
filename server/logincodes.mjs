/**
 * Код входа «как в Телеграме»: если у человека уже есть вошедшие устройства (живые, не ограниченные сессии), код приходит
 * сообщением в Sky на них (запись в «Уведомления» + живой показ на острове/тосте, push, если приложение закрыто), а не письмом.
 * Если таких устройств нет (новая почта, регистрация, все вышли) — код уходит на почту/SMS как раньше, сразу.
 * Клиенту ответ одинаков в обоих случаях: по нему нельзя узнать, есть ли такой аккаунт. Через 60 секунд на экране появляется
 * кнопка «Отправить на почту» (запрос с viaMail — тот же выпуск кода, но только письмом).
 */
import { query } from './db.mjs';
import { sessionStore } from './sessions.mjs';
import { findSkyIdByEmail, findSkyIdByPhone } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { pushToOffline, reachableNow } from './webpush.mjs';
import { L } from './lang.mjs';

/** Профили, чьи вошедшие устройства получат код. Пусто — доставить некуда. */
const liveProfiles = async (skyId) => {
  const sessions = await sessionStore.listForUser(skyId);
  const ids = new Set();
  for (const s of sessions) { if (s.profileId && !s.limited) ids.add(s.profileId); }
  if (!ids.size) return [];
  const { rows } = await query('SELECT id FROM profiles WHERE id = ANY($1::text[]) AND deleted_at IS NULL', [[...ids]]);
  return rows.map((r) => r.id);
};

/** true — код показан на устройствах человека (письмо не нужно). Любой сбой = false (код уйдёт письмом). */
export const deliverLoginCode = async (channel, destination, code) => {
  try {
    const sky = channel === 'email' ? await findSkyIdByEmail(destination) : await findSkyIdByPhone(destination);
    if (!sky) return false;
    const pids = await liveProfiles(sky.id);
    if (!pids.length) return false;
    /* Сессия может быть «живой» в Redis, а приложение закрыто и пуши не настроены — тогда код никто не увидит.
       На устройства — только тем, до кого дойдёт сейчас; иначе письмо/SMS сразу. */
    if (!(await reachableNow(pids)).length) return false;
    const title = L('Код для входа в Sky', 'Sky sign-in code');
    const body = L(`Код: ${code}. Никому его не сообщайте — сотрудники Sky его не спрашивают. Если вы не входите в Sky, не вводите код.`,
      `Code: ${code}. Do not share it with anyone — Sky staff never ask for it. If you are not signing in, do not enter it.`);
    await Promise.all(pids.map((pid) => notifyGift(pid, 'login_code', title, body, null)));
    void pushToOffline(pids, { title, body: L('Откройте Sky, чтобы увидеть код', 'Open Sky to see the code'), tag: 'login-code', urgent: true }).catch(() => {});
    return true;
  } catch (e) { console.error('[logincode] доставка на устройства:', e.message); return false; }
};

/** Коды входа в базе уведомлений не должны жить дольше самого кода. Зовётся из общей чистки кодов. */
export const purgeLoginCodeNotes = async () => {
  const { rowCount } = await query(`DELETE FROM gift_notifications WHERE kind = 'login_code' AND created_at < now() - interval '15 minutes'`);
  return rowCount;
};
