/**
 * Sky Safety — подтверждение безопасности после резкой остановки.
 *
 * Как устроено честно:
 *  — решает, что остановка «подозрительная», КЛИЕНТ (GPS-скорость + акселерометр/гироскоп, см. src/safety/detector.ts) и присылает сюда событие;
 *  — сервер создаёт событие со СРОКОМ и сразу просит человека подтвердить безопасность (сообщение от бота Sky + пуш);
 *  — если срок вышел без ответа, предупреждение доверенным контактам уходит с СЕРВЕРА, даже если приложение на телефоне закрыли или оно сломалось;
 *  — потеря GPS, обычная остановка и торможение — не повод: клиент не присылает событие, сервер не угадывает по тишине;
 *  — доверенным контактам уходит последняя известная точка и время, не больше; контакт должен был принять приглашение заранее;
 *  — не чаще одного события в 10 минут на человека; без включённой функции события не принимаются.
 * Это не вызов экстренных служб и не гарантия: функция помогает близким узнать, что человек не ответил.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { isRealPoint } from './maps.mjs';
import { featureOn } from './mapsusage.mjs';
import { friendIds } from './friends.mjs';
import { sendFromBot } from './skybot.mjs';
import { notifyGift } from './giftnotify.mjs';
import { pushToOffline } from './webpush.mjs';
import { L } from './lang.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';

const MAX_CONTACTS = 5;
const COOLDOWN_MIN = 10;
const id = () => `sfe-${crypto.randomBytes(8).toString('hex')}`;
/* Ссылка на карту без Яндекса: точку человека не отдаём поставщику карт ссылкой с точными координатами. */
const mapLink = (lat, lng) => `https://www.openstreetmap.org/?mlat=${Number(lat).toFixed(5)}&mlon=${Number(lng).toFixed(5)}#map=17/${Number(lat).toFixed(5)}/${Number(lng).toFixed(5)}`;
const openEventPos = (r) => {
  if (r.pos_enc) { try { const p = JSON.parse(decryptSecret(r.pos_enc)); return isRealPoint(p.lat, p.lng) ? p : null; } catch { return null; } }
  return r.lat != null ? { lat: r.lat, lng: r.lng } : null;
};

export const getState = async (me) => {
  const { rows: s } = await query('SELECT enabled, timeout_sec FROM safety_settings WHERE profile_id = $1', [me]);
  const { rows: out } = await query(
    `SELECT c.contact_id AS id, c.status, p.name, p.username FROM safety_contacts c JOIN profiles p ON p.id = c.contact_id WHERE c.owner_id = $1 ORDER BY p.name`, [me]);
  const { rows: inc } = await query(
    `SELECT c.owner_id AS id, p.name, p.username FROM safety_contacts c JOIN profiles p ON p.id = c.owner_id WHERE c.contact_id = $1 AND c.status = 'pending'`, [me]);
  const { rows: guard } = await query(`SELECT count(*)::int AS n FROM safety_contacts WHERE contact_id = $1 AND status = 'accepted'`, [me]);
  const { rows: ev } = await query(`SELECT id, deadline_at FROM safety_events WHERE profile_id = $1 AND state = 'pending' ORDER BY created_at DESC LIMIT 1`, [me]);
  return {
    enabled: s[0]?.enabled ?? false, timeoutSec: s[0]?.timeout_sec ?? 60,
    contacts: out, invitations: inc, watchingCount: guard[0].n,
    pending: ev[0] ? { id: ev[0].id, deadlineAt: new Date(ev[0].deadline_at).toISOString() } : null,
    friends: await (async () => {
      const ids = await friendIds(me); if (!ids.length) return [];
      const { rows } = await query('SELECT id, name, username FROM profiles WHERE id = ANY($1::text[]) AND deleted_at IS NULL ORDER BY name', [ids]);
      return rows;
    })(),
  };
};

export const saveSettings = async (me, { enabled, timeoutSec } = {}) => {
  if (!(await featureOn('safety'))) return { error: 'feature_off' };
  const t = Math.floor(Number(timeoutSec ?? 60));
  if (!Number.isFinite(t) || t < 30 || t > 180) return { error: 'bad_timeout' };
  if (enabled) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM safety_contacts WHERE owner_id = $1 AND status = 'accepted'`, [me]);
    if (!rows[0].n) return { error: 'need_contact' };
  }
  await query(`INSERT INTO safety_settings (profile_id, enabled, timeout_sec) VALUES ($1,$2,$3)
               ON CONFLICT (profile_id) DO UPDATE SET enabled = $2, timeout_sec = $3, updated_at = now()`, [me, Boolean(enabled), t]);
  return { ok: true };
};

export const addContact = async (me, contactId) => {
  if (!(await featureOn('safety'))) return { error: 'feature_off' };
  const cid = String(contactId ?? '');
  if (!cid || cid === me) return { error: 'bad_contact' };
  if (!(await friendIds(me)).includes(cid)) return { error: 'not_friends' };
  const { rows } = await query('SELECT count(*)::int AS n FROM safety_contacts WHERE owner_id = $1', [me]);
  if (rows[0].n >= MAX_CONTACTS) return { error: 'too_many' };
  const r = await query(`INSERT INTO safety_contacts (owner_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [me, cid]);
  if (r.rowCount) {
    const { rows: nm } = await query('SELECT name FROM profiles WHERE id = $1', [me]);
    void sendFromBot(cid, L(`🛡 ${nm[0]?.name ?? 'Ваш друг'} просит вас стать его доверенным контактом в Sky Safety.\n\nЕсли человек не подтвердит безопасность после резкой остановки, вам придёт сообщение с его последним положением. Принять или отказаться можно в разделе «Карта друзей».`,
      `🛡 ${nm[0]?.name ?? 'Your friend'} asks you to be their trusted contact in Sky Safety.\n\nIf they do not confirm they are safe after a sudden stop, you will get a message with their last location. You can accept or decline in “Friends map”.`), { kind: 'safety' });
  }
  return { ok: true };
};

export const removeContact = async (me, contactId) => {
  await query('DELETE FROM safety_contacts WHERE owner_id = $1 AND contact_id = $2', [me, String(contactId ?? '')]);
  const { rows } = await query(`SELECT count(*)::int AS n FROM safety_contacts WHERE owner_id = $1 AND status = 'accepted'`, [me]);
  if (!rows[0].n) await query('UPDATE safety_settings SET enabled = FALSE WHERE profile_id = $1', [me]);   // без контактов предупреждать некого
  return { ok: true };
};

export const answerInvite = async (me, ownerId, accept) => {
  if (accept) {
    const r = await query(`UPDATE safety_contacts SET status = 'accepted' WHERE owner_id = $1 AND contact_id = $2 AND status = 'pending'`, [String(ownerId ?? ''), me]);
    return r.rowCount ? { ok: true } : { error: 'not_found' };
  }
  await query('DELETE FROM safety_contacts WHERE owner_id = $1 AND contact_id = $2', [String(ownerId ?? ''), me]);
  return { ok: true };
};

/** Клиент заметил резкую остановку после быстрой езды. */
export const trigger = async (me, input = {}) => {
  if (!(await featureOn('safety'))) return { error: 'feature_off' };
  const { rows: s } = await query('SELECT enabled, timeout_sec FROM safety_settings WHERE profile_id = $1', [me]);
  if (!s[0]?.enabled) return { error: 'not_enabled' };
  const speed = Number(input.speedBeforeKmh);
  if (!Number.isFinite(speed) || speed < 30 || speed > 400) return { error: 'bad_speed' };   // сервер не принимает «остановку» без быстрой езды перед ней
  const { rows: recent } = await query(`SELECT 1 FROM safety_events WHERE profile_id = $1 AND created_at > now() - ($2 || ' minutes')::interval LIMIT 1`, [me, String(COOLDOWN_MIN)]);
  if (recent.length) return { error: 'cooldown' };
  const hasPoint = isRealPoint(Number(input.lat), Number(input.lng));
  const eid = id();
  await query(`INSERT INTO safety_events (id, profile_id, lat, lng, pos_enc, speed_before_kmh, drop_kmh, signals, deadline_at)
               VALUES ($1,$2,NULL,NULL,$3,$4,$5,$6, now() + ($7 || ' seconds')::interval)`,
    [eid, me, hasPoint ? encryptSecret(JSON.stringify({ lat: Number(input.lat), lng: Number(input.lng) })) : null, speed, Number.isFinite(Number(input.dropKmh)) ? Number(input.dropKmh) : null,
      String(input.signals ?? '').replace(/[^a-z,_]/g, '').slice(0, 60), String(s[0].timeout_sec)]);
  void sendFromBot(me, L('⚠️ Мы заметили резкую остановку. Откройте Sky и нажмите «Я в порядке» — иначе доверенные контакты получат предупреждение.', '⚠️ We noticed a sudden stop. Open Sky and tap “I’m OK” — otherwise your trusted contacts will be notified.'),
    { kind: 'security', pushBody: L('Вы в порядке? Подтвердите безопасность в Sky', 'Are you OK? Confirm you are safe in Sky') });
  return { ok: true, id: eid, deadlineSec: s[0].timeout_sec };
};

export const confirmSafe = async (me, eventId) => {
  const r = await query(`UPDATE safety_events SET state = 'confirmed', resolved_at = now() WHERE id = $1 AND profile_id = $2 AND state = 'pending'`, [String(eventId ?? ''), me]);
  return r.rowCount ? { ok: true } : { error: 'not_found' };
};

/** Уборка (раз в 10 с): события без ответа за срок → предупреждение доверенным контактам. Один раз на событие (условный UPDATE). */
export const sweepSafety = async () => {
  const { rows } = await query(`UPDATE safety_events SET state = 'alerted', resolved_at = now() WHERE state = 'pending' AND deadline_at <= now() RETURNING id, profile_id, lat, lng, pos_enc, speed_before_kmh, created_at`);
  for (const e of rows) {
    try {
      const { rows: who } = await query('SELECT name FROM profiles WHERE id = $1', [e.profile_id]);
      const { rows: cs } = await query(`SELECT contact_id FROM safety_contacts WHERE owner_id = $1 AND status = 'accepted'`, [e.profile_id]);
      if (!cs.length) { await query(`UPDATE safety_events SET state = 'no_contacts' WHERE id = $1`, [e.id]); continue; }
      const name = who[0]?.name ?? '—';
      const at = new Date(e.created_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      const pos = openEventPos(e);
      const place = pos ? `${L('Последнее известное положение', 'Last known location')}: ${mapLink(pos.lat, pos.lng)}` : L('Положение определить не удалось.', 'Location could not be determined.');
      const text = L(`🚨 ${name} не ответил(а) на проверку безопасности после резкой остановки (${at}). Скорость перед остановкой — около ${Math.round(e.speed_before_kmh)} км/ч.\n\n${place}\n\nЭто не доказательство происшествия — возможно, человек просто не видел уведомление. Свяжитесь с ним; при тревоге звоните в экстренные службы.`,
        `🚨 ${name} did not answer the safety check after a sudden stop (${at}). Speed before stopping — about ${Math.round(e.speed_before_kmh)} km/h.\n\n${place}\n\nThis is not proof of an incident — the person may simply not have seen the notice. Try to reach them; if worried, call emergency services.`);
      for (const c of cs) {
        await sendFromBot(c.contact_id, text, { kind: 'security', pushBody: L(`${name} не ответил(а) на проверку безопасности`, `${name} did not answer a safety check`) });
        await notifyGift(c.contact_id, 'account_security', L('Проверка безопасности без ответа', 'Safety check unanswered'), text).catch(() => {});
      }
      await query(`UPDATE safety_events SET lat = NULL, lng = NULL, pos_enc = NULL WHERE id = $1`, [e.id]);
      void sendFromBot(e.profile_id, L('Срок подтверждения истёк — доверенным контактам отправлено предупреждение.', 'The time to confirm has passed — your trusted contacts were notified.'), { kind: 'security' });
    } catch (err) { console.error('[safety] предупреждение:', err.message); }
  }
  return rows.length;
};
